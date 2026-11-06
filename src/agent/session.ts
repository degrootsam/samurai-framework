import { maskDeep } from "../config/mask.js";
import type { AgentEvent, AgentResult } from "./types.js";

type Mode = "running" | "paused" | "taken-over";
export type AbortReason = "stopped" | "time-limit" | "token-limit";

/** What taking the browser over starts and ends: the recording of what the person does */
export interface TakeOverHooks {
  begin(): Promise<void>;
  /** Ends the recording; the text tells the agent what the person did */
  end(): Promise<string>;
}

/**
 * The state of one run that the person controls: the event stream, pause and take over, the open questions, stop,
 * and the active time. Time spent paused, taken over or waiting for an answer does not count against the time
 * limit: it is the person's time, not the agent's.
 */
export class AgentController {
  private readonly log: AgentEvent[] = [];
  private readonly readers = new Set<() => void>();
  private closed = false;
  private mode: Mode = "running";
  private transition: Promise<void> = Promise.resolve();
  private readonly gateWaiters = new Set<() => void>();
  private readonly aborter = new AbortController();
  private abortReason: AbortReason | undefined;
  private readonly questions = new Map<
    string,
    { answer(text: string): void; fail(error: Error): void }
  >();
  private asked = 0;
  private note: string | undefined;
  private readonly startedAt = Date.now();
  private idleSince: number | undefined;
  private idleTotal = 0;

  constructor(
    private readonly hooks: TakeOverHooks,
    private readonly onEvent?: (event: AgentEvent) => void,
  ) {}

  /** Aborts when the run is stopped or a limit is reached */
  public get signal(): AbortSignal {
    return this.aborter.signal;
  }

  public get stopReason(): AbortReason | undefined {
    return this.abortReason;
  }

  public get events(): AsyncIterable<AgentEvent> {
    return { [Symbol.asyncIterator]: () => this.read() };
  }

  private async *read(): AsyncGenerator<AgentEvent> {
    for (let index = 0; ;) {
      while (index < this.log.length) yield this.log[index++]!;
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        const wake = () => {
          this.readers.delete(wake);
          resolve();
        };
        this.readers.add(wake);
      });
    }
  }

  public emit(event: AgentEvent): void {
    if (this.closed) return;
    const safe = maskDeep(event);
    this.log.push(safe);
    try {
      this.onEvent?.(safe);
    } catch {
      // a failing listener must not stop the run
    }
    for (const wake of [...this.readers]) wake();
  }

  /** Emits `ended` once; later calls change nothing */
  public end(result: AgentResult): void {
    if (this.closed) return;
    this.emit({ type: "ended", result });
    this.closed = true;
    for (const wake of [...this.readers]) wake();
  }

  /** Time the agent has been working, in ms */
  public activeMs(now = Date.now()): number {
    const idle = this.idleSince === undefined ? 0 : now - this.idleSince;
    return now - this.startedAt - this.idleTotal - idle;
  }

  private touch(): void {
    const idle = this.mode !== "running" || this.questions.size > 0;
    const now = Date.now();
    if (idle && this.idleSince === undefined) this.idleSince = now;
    if (!idle && this.idleSince !== undefined) {
      this.idleTotal += now - this.idleSince;
      this.idleSince = undefined;
    }
  }

  private wake(): void {
    for (const resume of [...this.gateWaiters]) resume();
    this.gateWaiters.clear();
  }

  /** Resolves when the agent may act; rejects when the run was stopped or hit a limit */
  public async gate(): Promise<void> {
    for (;;) {
      this.signal.throwIfAborted();
      await this.transition;
      this.signal.throwIfAborted();
      if (this.mode === "running") return;
      await new Promise<void>((resolve) => this.gateWaiters.add(resolve));
    }
  }

  public pause(): void {
    if (this.mode !== "running") return;
    this.mode = "paused";
    this.touch();
  }

  public resume(): void {
    if (this.mode !== "paused") return;
    this.mode = "running";
    this.touch();
    this.wake();
  }

  public takeOver(): void {
    if (this.mode === "taken-over") return;
    this.mode = "taken-over";
    this.touch();
    this.transition = this.transition
      .then(() => this.hooks.begin())
      .catch(() => undefined);
  }

  public handBack(): void {
    if (this.mode !== "taken-over") return;
    this.transition = this.transition
      .then(async () => {
        this.note = await this.hooks.end();
      })
      .catch(() => undefined)
      .then(() => {
        this.mode = "running";
        this.touch();
        this.wake();
      });
  }

  /** The note for the agent about what the person did, once, after a hand back */
  public takeNote(): string | undefined {
    const note = this.note;
    this.note = undefined;
    return note;
  }

  /** Waits for a hand back that is still ending the person's recording (the run is ending anyway) */
  public settle(): Promise<void> {
    return this.transition;
  }

  /** Asks the person; waits without counting against the time limit. Rejects when the run stops */
  public ask(question: string, options?: string[]): Promise<string> {
    const id = `q${++this.asked}`;
    return new Promise<string>((resolve, reject) => {
      this.questions.set(id, {
        answer: (text) => resolve(text),
        fail: reject,
      });
      this.touch();
      this.emit({
        type: "question",
        id,
        question,
        ...(options && options.length > 0 && { options }),
      });
    }).finally(() => {
      this.questions.delete(id);
      this.touch();
    });
  }

  public answer(id: string, text: string): void {
    const open = this.questions.get(id);
    if (!open) throw new Error(`agent(): there is no open question ${id}`);
    open.answer(text);
  }

  /** Ends the run early: `stop()` from the person, or a limit */
  public abort(reason: AbortReason): void {
    if (this.abortReason) return;
    this.abortReason = reason;
    this.aborter.abort(new Error(`agent run ended: ${reason}`));
    for (const open of this.questions.values())
      open.fail(new Error("agent run ended"));
    this.wake();
  }

  public stop(): void {
    this.abort("stopped");
  }

  /** Aborts with `time-limit` once the active time passes `timeoutMs`. Returns the function that stops the check */
  public watchTime(timeoutMs: number): () => void {
    const timer = setInterval(
      () => {
        if (this.activeMs() >= timeoutMs) this.abort("time-limit");
      },
      Math.min(250, Math.max(10, timeoutMs / 4)),
    );
    timer.unref();
    return () => clearInterval(timer);
  }
}
