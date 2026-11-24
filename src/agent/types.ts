import type { RecorderEvent } from "../recorder/normalise.js";
import type { ProjectOptions } from "../runner/project.js";
import type { SupportedBrowser } from "../types/browser.js";
import type { AgentLimits } from "./limits.js";
import type { AgentModel } from "./model.js";
import type { ModelRefusal } from "./refusal.js";
import type { PlanSendQuestion } from "./plan/send-question.js";

/** What the agent does, as a stream both the app and the command line render */
export type AgentEvent =
  /** The agent's plan: what it intends to do, in a few lines */
  | { type: "plan"; text: string }
  /** A tool was called; secret values are removed from `args` */
  | { type: "tool-call"; tool: string; args: unknown }
  /** A step was written to the spec: the recorder event, the statement it produced and the file's new content */
  | { type: "step"; event: RecorderEvent; code?: string; source: string }
  /**
   * The agent needs the person; answer through the session. With `send` it is a planning run holding a request
   * that would change data: answer `send` to let that one request go, anything else (`decline`) to stop it
   */
  | {
      type: "question";
      id: string;
      question: string;
      options?: string[];
      send?: PlanSendQuestion;
    }
  /** Tokens used by one model call */
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      /** Input tokens the provider read from its prompt cache, when it reports them */
      cachedInputTokens?: number;
    }
  /** Continue mode: step `n` of `total` (1-based) is being replayed on the page; it is not written again */
  | { type: "replay"; n: number; total: number; text: string }
  /** A planning run recorded step `n` of the plan file */
  | { type: "plan-step"; n: number; text: string }
  | { type: "ended"; result: AgentResult }
  /**
   * Only with `liveView`: the page as the browser shows it now. Frames are not part of the recorded event log:
   * `onEvent` gets each one, `session.events` only the newest one a slow reader has not seen yet
   */
  | LiveFrameEvent
  /** Only with `liveView`: the page's address or title changed (sent once at the start too) */
  | { type: "url"; url: string; title: string; at: number }
  /** Only with `liveView`: the agent did something to an element; sent right after the action, before the frame that shows its result */
  | LiveActedEvent
  /**
   * Only in a run that follows a plan (`plan`), and only when the plan's steps can be read: the agent says which
   * plan step it starts, by calling the `planStep` tool. Not sent twice in a row for the same step, and never for
   * a number outside the plan
   */
  | PlanStepEvent
  /** Only with `liveView`: the agent's own one-line commentary, from the `note` it gave to a tool call */
  | NarrationEvent;

/** The agent is on this step of the plan it follows */
export interface PlanStepEvent {
  type: "planStep";
  /** 0-based index into the plan's steps (the plan's step number minus one) */
  index: number;
  /** The number of steps in the plan */
  total: number;
  at: number;
}

/** A short sentence the agent wrote about what it saw or will do next; secret values and typed values are removed */
export interface NarrationEvent {
  type: "narration";
  /** One line, at most 160 characters */
  text: string;
  at: number;
}

/** One picture of the page. `width`/`height` and the box of `acted` events are CSS pixels of the viewport; the image is `width` x `devicePixelRatio` pixels wide */
export interface LiveFrameEvent {
  type: "frame";
  mime: "image/jpeg" | "image/png";
  /** The image, Base64 */
  data: string;
  /** The viewport in CSS pixels */
  width: number;
  height: number;
  devicePixelRatio: number;
  /** Epoch milliseconds when the frame was taken */
  at: number;
}

/** The element the agent acted on and what it did */
export interface LiveActedEvent {
  type: "acted";
  /** The element's box in CSS pixels from the viewport's top left, the coordinate space of the frames */
  box: { x: number; y: number; width: number; height: number };
  /** For example `clicked "Pay now"`; never holds a typed value */
  label: string;
  /** The number of steps in the test after this action wrote its step (absent when it wrote none) */
  step?: number;
  at: number;
}

/** What `liveView` can set */
export interface LiveViewOptions {
  /** The most frames per second while the page changes or an action runs. 0.2 to 10. @default 4 */
  maxFps?: number;
  /** JPEG quality, 1 to 100 (PNG is the fallback for a browser that cannot do JPEG). @default 60 */
  quality?: number;
}

export type AgentEndReason =
  | "finished"
  | "stopped"
  | "step-limit"
  | "token-limit"
  | "time-limit"
  | "error";

/** How a run ended and what it left behind: the spec is valid whatever the reason */
export interface AgentResult {
  reason: AgentEndReason;
  /** The agent's own summary when it finished */
  summary?: string;
  /** The error text when `reason` is `error` */
  error?: string;
  /**
   * With `error`: the model's endpoint (a gateway in front of the model) refused the request with a `{ error, code }` answer:
   * its HTTP status, `code` and `retry-after` in seconds. Absent for any other failure
   */
  refusal?: ModelRefusal;
  /**
   * Set (to `"replay"`) when `reason` is `error` and the run failed while replaying the steps of an existing test
   * (`continueAt`), before the agent wrote anything: the test file was not changed. Absent for every other result,
   * including a failure after the replay.
   */
  failedIn?: "replay";
  /** With `failedIn`: the 1-based number of the step that failed or cannot be replayed (as in "step N ..."), when known */
  replayStep?: number;
  file: string;
  /** Full name of the test the steps went into */
  test: string;
  steps: number;
  /** Names the written steps read with `secrets.<NAME>` */
  secrets: string[];
  tokens: number;
}

/** What every kind of run takes: the model, the goal, the browser and the limits */
export interface BaseAgentOptions extends ProjectOptions {
  /** The model, as an object from an AI SDK provider package. A string is refused */
  model: AgentModel;
  /** What the test should do, in the person's words */
  goal: string;
  /** Where the browser starts. @default the environment's base URL */
  url?: string;
  browser?: SupportedBrowser;
  /** The browser's debugging port. @default DEFAULT_PORT (9223) */
  port?: number;
  /** Run the browser without a window. A person watching or taking over needs one. @default false */
  headless?: boolean;
  /** Origins the agent may navigate to without asking. @default the origin of the start page */
  allowedOrigins?: string[];
  /** Secrets the agent may use, by name; their values are read locally and never sent to the model. @default none */
  secrets?: string[];
  /** CSS selectors of fields whose value must never be shown to the model, besides password fields */
  secretFields?: string[];
  /** Whether the model takes images, so `screenshot` works. @default false */
  vision?: boolean;
  limits?: Partial<AgentLimits>;
  /**
   * Stream what the agent's page looks like: `frame`, `url` and `acted` events. Frames come only while the page
   * changes, an action runs or the person drives, and a slow consumer misses frames instead of slowing the
   * agent. `true` takes the defaults. It also turns on `narration` events: the tools then take an optional `note`.
   * @default false
   */
  liveView?: boolean | LiveViewOptions;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentOptions extends BaseAgentOptions {
  /** The spec file, absolute or relative to the project folder */
  file: string;
  /** Add a test with this title to the file (creating it) instead of writing into an existing one */
  create?: string;
  /** The existing test to write into (title or index), as for `recordSpec` */
  test?: string | number;
  /**
   * Continue an existing test (needs `test`, not `create`): the number of its steps, from the start, to replay
   * and keep before the agent's own. The browser is opened, steps `0..continueAt-1` are replayed on the page
   * without the model (a `replay` event for each), then the agent writes new steps at that index; the steps
   * after it stay after the new ones. Assertions and evidence (`expect`, `saveOutput`, `screenshot`) are skipped
   * on replay; a `custom` step cannot be replayed and ends the run with an error; the test's fixtures are set up first.
   * Between 0 (nothing replayed, new steps go first) and the number of steps of the test.
   */
  continueAt?: number;
  /** The text of a plan written earlier (see `runPlan`): a draft to follow and check on the live page */
  plan?: string;
  /**
   * The plan file the `plan` text came from, relative to the project folder (an absolute path is made relative).
   * The test is marked with `{ type: "plan", description: <this path> }` in its `annotations` option
   */
  planFile?: string;
}

/** A planning run: explores the page and writes a Markdown plan, never a spec; it asks before it sends a form */
export interface PlanOptions extends BaseAgentOptions {
  /** The plan file, absolute or relative to the project folder */
  out: string;
  /** Overwrite `out` when it exists. @default false */
  force?: boolean;
  /**
   * What a request that changes data (a form submit) does: `"ask"` holds it and asks the person through the
   * session (a `question` event with `send`), `"block"` stops it without asking. @default "ask"
   */
  forms?: "ask" | "block";
}

/** How a planning run ended: `file` is the plan, `steps` the plan steps */
export type PlanResult = Omit<AgentResult, "test">;

/** A planning run in progress; the same controls as an `AgentSession` */
export type PlanSession = Omit<AgentSession, "result"> & {
  readonly result: Promise<PlanResult>;
};

/** A run in progress */
export interface AgentSession {
  readonly events: AsyncIterable<AgentEvent>;
  /** Settles when the run has ended; it never rejects, a failure is `reason: "error"` */
  readonly result: Promise<AgentResult>;
  /** Answers the question with this `id` */
  answer(id: string, text: string): void;
  /** The agent stops acting after the call it is in the middle of */
  pause(): void;
  resume(): void;
  /** The agent stops acting and the person drives the browser */
  takeOver(): void;
  /** The agent carries on from the page as the person left it */
  handBack(): void;
  stop(): void;
}
