import type { Observation, RecorderEvent } from "../../recorder/normalise.js";
import type { RunSink } from "../run-kind.js";
import type { PlanFile } from "./plan-file.js";
import type { PlanSendOutcome } from "./send-question.js";

/** The path of a URL, for a note */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * What a planning run keeps: the plan file, how many things were done on the page, and the
 * requests the guard held. `observe` is how the shared tools (`act`, `navigate`) report what they did; they
 * write nothing, a plan step is the agent's own words (`step`).
 */
export class PlanRecorder implements RunSink {
  private done = 0;
  private notes: string[] = [];
  private reason: string | undefined;
  private label: string | undefined;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly plan: PlanFile,
    private readonly onStep: (n: number, text: string) => void,
  ) {}

  public get count(): number {
    return this.plan.count;
  }

  public get file(): string {
    return this.plan.file;
  }

  public get testName(): string {
    return this.plan.title;
  }

  public observe(_observation: Observation): RecorderEvent[] {
    this.done++;
    return [];
  }

  public undo(_count: number): number {
    return 0;
  }

  /** Records a step the agent has done on the live page; refused when every action so far is already a step */
  public addStep(text: string, expect?: string): number {
    if (this.plan.count >= this.done)
      throw new Error(
        `all ${this.done} actions so far are already recorded as steps; act first`,
      );
    const n = this.plan.addStep(text, expect);
    this.onStep(n, text);
    return n;
  }

  public setStart(url: string): void {
    this.plan.setStart(url);
  }

  public seen(text: string): void {
    this.plan.seen(text);
  }

  public notDone(text: string): void {
    this.plan.notDone(text);
  }

  public question(text: string): void {
    this.plan.question(text);
  }

  /**
   * A held request ended. A request that was not sent goes into the plan's "Open questions" (what the planner
   * could not check) and every outcome is a note for the agent's next tool answer
   */
  public sendOutcome(outcome: PlanSendOutcome): void {
    const what = `${outcome.method} ${pathOf(outcome.url)}`;
    if (outcome.outcome === "sent") {
      const got = [
        outcome.status !== undefined && String(outcome.status),
        outcome.snippet && `"${outcome.snippet}"`,
      ].filter(Boolean);
      this.notes.push(
        `sent: the person allowed ${what}${got.length > 0 ? `, the app answered ${got.join(" ")}` : ""}; note what it showed with seen`,
      );
      return;
    }
    const why =
      outcome.outcome === "declined"
        ? "the person did not allow it"
        : "nobody could be asked";
    this.plan.question(
      `What does the app do after ${what}? Not checked: ${why}.`,
    );
    this.notes.push(
      `not sent: ${why} (${what}); it is written under Open questions, do not try it again`,
    );
  }

  /** Remembers why the agent is about to act, for the question a held request asks */
  public setReason(text: string | undefined): void {
    this.reason = text;
  }

  /** Remembers the name of the element the agent acted on, for the same question */
  public setLabel(text: string | undefined): void {
    this.label = text;
  }

  public get currentLabel(): string | undefined {
    return this.label;
  }

  public get currentReason(): string | undefined {
    return this.reason;
  }

  /** Remembers a held request's handling; `settled` waits for it */
  public track(done: Promise<void>): void {
    this.pending.add(done);
    void done.finally(() => this.pending.delete(done));
  }

  /** Resolves when no held request is waiting for an answer any more */
  public async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /** What happened to held requests since the last call, once */
  public takeNotes(): string[] {
    const list = this.notes;
    this.notes = [];
    return list;
  }
}
