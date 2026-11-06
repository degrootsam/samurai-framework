import type { Observation, RecorderEvent } from "../../recorder/normalise.js";
import type { RunSink } from "../run-kind.js";
import type { PlanFile } from "./plan-file.js";

/**
 * What a planning run keeps: the plan file, how many things were done on the page, and the
 * requests the guard stopped. `observe` is how the shared tools (`act`, `navigate`) report what they did; they
 * write nothing, a plan step is the agent's own words (`step`).
 */
export class PlanRecorder implements RunSink {
  private done = 0;
  private blocked = new Set<string>();

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

  /** The guard stopped a request */
  public block(what: string): void {
    this.blocked.add(what);
  }

  /** What was stopped since the last call, once */
  public takeBlocked(): string[] {
    const list = [...this.blocked];
    this.blocked = new Set();
    return list;
  }
}
