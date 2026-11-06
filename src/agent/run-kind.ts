import type Page from "../browser/page.js";
import type { PromptInput } from "./prompt.js";
import type { PersonRecording } from "./take-over.js";
import type { Snapshotter } from "./snapshot.js";
import type { AgentTool, ToolContext, ToolSink } from "./tools/context.js";
import type { AgentEvent, BaseAgentOptions } from "./types.js";

/** What a run keeps of its work: the spec's steps, or the plan's. `AgentResult` is made from it */
export interface RunSink extends ToolSink {
  /** Steps written so far */
  readonly count: number;
  /** The file the run writes */
  readonly file: string;
  /** Name of the test, or title of the plan */
  readonly testName: string;
}

/** What the sink is made from */
interface SinkInput {
  baseURL: string | undefined;
  emit(event: AgentEvent): void;
}

/** What replaying the test's steps needs from the run */
interface ReplayInput {
  page: Page;
  /** The environment's variables (`env.NAME`) */
  variables: Readonly<Record<string, string | number | boolean>>;
  /** The value of a secret in the run's environment; read locally, never shown */
  secret(name: string): string | undefined;
  emit(event: AgentEvent): void;
}

/**
 * What a run swaps for another kind of run: what it records, which tools it has, what the prompt says and what
 * guards the page. The browser, the limits, the origin policy, the controller and the event stream stay the same.
 */
export interface RunKind<
  O extends BaseAgentOptions = BaseAgentOptions,
  S extends RunSink = RunSink,
> {
  /** The file the result names when no sink was made (the run failed before) */
  file(options: O): string;
  /** Makes the sink; throws a sentence when the file cannot be used. Runs before the browser opens */
  sink(options: O, input: SinkInput): S;
  /**
   * Runs after the page is open and before the first snapshot: brings the page to the state the run continues
   * from. Returns the absolute URLs it opened, whose origins the agent may then use too
   */
  replay?(sink: S, input: ReplayInput): Promise<string[]>;
  /** The page is open on `url`: a first step may be recorded */
  opened?(sink: S, url: string): void;
  tools(context: ToolContext, sink: S): AgentTool[];
  prompt(input: PromptInput, options: O): string;
  /** The first message after the goal: the page as it is now, or that there is none */
  opening(options: O, first: string, sink: S): string;
  /** Names the secrets the written steps read */
  secrets(sink: S): string[];
  /** Runs once the page is open, before the model's first call */
  guard?(page: Page, sink: S): Promise<void>;
  /** What the person's use of the browser does to the record */
  person(input: {
    page: Page;
    sink: S;
    snapshots: Snapshotter;
    baseURL?: string;
  }): PersonRecording;
}
