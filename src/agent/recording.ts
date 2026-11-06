import path from "node:path";
import { projectDir } from "../config/config.js";
import {
  Normaliser,
  type Observation,
  type RecorderEvent,
} from "../recorder/normalise.js";
import { prepareSpec, readSpec, SpecWriter } from "../recorder/spec-source.js";
import { linkPlan } from "./plan-link.js";
import { stepToSource } from "../steps/emit.js";
import { parseSpec } from "../steps/parse.js";
import type { Step, TestInput } from "../steps/model.js";

export interface StepRecorderOptions {
  /** The spec file, absolute or relative to the project folder */
  file: string;
  /** Add a test with this title (and create the file) */
  create?: string | undefined;
  /** The existing test to write into, as for `recordSpec` */
  test?: string | number | undefined;
  /** The plan the test is made from, as `AgentOptions.planFile`: written on the test as a `plan` annotation */
  planFile?: string | undefined;
  /** Continue the test: the steps are written at this index, and the ones from it on stay after them */
  at?: number | undefined;
  /** Relative URLs are written against this */
  baseURL?: string | undefined;
  /** Called after each event is written, with the statement it produced and the file's new content */
  onStep?: (
    event: RecorderEvent,
    code: string | undefined,
    source: string,
  ) => void;
}

/** The statement an event wrote, `undefined` for a removal */
function codeOf(event: RecorderEvent): string | undefined {
  return event.op === "remove" ? undefined : stepToSource(event.step);
}

/** What a tool tells the model about the steps it wrote */
export function writtenText(events: readonly RecorderEvent[]): string {
  const codes = events.flatMap((event) => codeOf(event) ?? []);
  return codes.length > 0 ? ` Step written: ${codes.join(" ")}` : "";
}

/**
 * Writes the agent's steps the way a recording does: an observation goes through the recorder's normaliser and
 * `SpecWriter`, so the file is a valid spec after every call and holds only typed steps.
 */
export class StepRecorder {
  private normaliser: Normaliser;
  private readonly writer: SpecWriter;
  private steps: number;
  /** Steps the test had before the agent wrote any: `undo` never goes below them */
  private readonly first: number;
  /** The test the steps go into, by its full name */
  public readonly testName: string;
  public readonly file: string;
  /** The test's steps before the index the agent writes at, in order: what continue mode replays */
  public readonly before: readonly Step[];
  /** The test's steps from that index on, which stay after the agent's */
  public readonly after: readonly Step[];
  /** The agent continues an existing test: `before` was replayed, `after` stays behind its steps */
  public readonly continuing: boolean;
  /** The inputs the test declares, with their defaults */
  public readonly inputs: readonly TestInput[];

  constructor(private readonly options: StepRecorderOptions) {
    this.file = path.resolve(projectDir(), options.file);
    const spec = prepareSpec(this.file, readSpec(this.file, options), {
      ...options,
      atName: "continueAt",
    });
    const test = parseSpec(spec.source)[spec.testIndex]!;
    const written = test.steps.map(({ step }) => step);
    this.before = written.slice(0, spec.at);
    this.after = written.slice(spec.at);
    this.inputs = test.inputs ?? [];
    this.continuing = options.at !== undefined;
    this.testName = spec.testName;
    this.writer = new SpecWriter(spec.source, this.file, spec.testIndex);
    const planFile = options.planFile;
    if (planFile !== undefined)
      this.writer.rewrite((source) =>
        linkPlan(source, spec.testIndex, planFile),
      );
    this.steps = spec.at;
    this.first = spec.at;
    this.normaliser = this.fresh();
  }

  private fresh(): Normaliser {
    return new Normaliser({
      at: this.steps,
      ...(this.options.baseURL !== undefined && {
        baseURL: this.options.baseURL,
      }),
    });
  }

  /** Steps in the test now */
  public get count(): number {
    return this.steps;
  }

  /** The events written so far */
  public get events(): readonly RecorderEvent[] {
    return this.writer.events;
  }

  private write(event: RecorderEvent): void {
    const source = this.writer.write(event);
    if (event.op === "insert") this.steps++;
    else if (event.op === "remove") this.steps--;
    this.options.onStep?.(event, codeOf(event), source);
  }

  /** Writes what `observation` makes of the spec and returns the events, which hold the statements */
  public observe(observation: Observation): RecorderEvent[] {
    const events = this.normaliser.observe(observation, Date.now());
    for (const event of events) this.write(event);
    return events;
  }

  /** Takes out the last `count` steps (at most the ones written in this run) and returns how many went */
  public undo(count: number): number {
    const removed = Math.max(0, Math.min(count, this.steps - this.first));
    for (let i = 0; i < removed; i++)
      this.write({ op: "remove", index: this.steps - 1 });
    if (removed > 0) this.normaliser = this.fresh();
    return removed;
  }

  /** Writes an event a person's recording produced while the agent was not acting (see `rebase`) */
  public external(event: RecorderEvent): void {
    this.write(event);
  }

  /** Starts the agent's own normaliser again after the person's steps: it carries on after the last one */
  public rebase(): void {
    this.normaliser = this.fresh();
  }
}
