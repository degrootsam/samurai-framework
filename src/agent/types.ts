import type { RecorderEvent } from "../recorder/normalise.js";
import type { ProjectOptions } from "../runner/project.js";
import type { SupportedBrowser } from "../types/browser.js";
import type { AgentLimits } from "./limits.js";
import type { AgentModel } from "./model.js";

/** What the agent does, as a stream both the app and the command line render */
export type AgentEvent =
  /** The agent's plan: what it intends to do, in a few lines */
  | { type: "plan"; text: string }
  /** A tool was called; secret values are removed from `args` */
  | { type: "tool-call"; tool: string; args: unknown }
  /** A step was written to the spec: the recorder event, the statement it produced and the file's new content */
  | { type: "step"; event: RecorderEvent; code?: string; source: string }
  /** The agent needs the person; answer through the session */
  | { type: "question"; id: string; question: string; options?: string[] }
  /** Tokens used by one model call */
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }
  /** A planning run recorded step `n` of the plan file */
  | { type: "plan-step"; n: number; text: string }
  | { type: "ended"; result: AgentResult };

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
  /** The text of a plan written earlier (see `runPlan`): a draft to follow and check on the live page */
  plan?: string;
}

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
