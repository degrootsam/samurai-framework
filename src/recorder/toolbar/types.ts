import type { ElementHandle } from "../../script/element-handle.js";
import type { LocatorCall, LocatorSpec } from "../../steps/model.js";
import type { Observation } from "../normalise.js";
import type {
  ActionReply,
  PageInfo,
  PickInfo,
  ToolbarMessage,
  ToolbarState,
} from "./protocol.js";

/** What `inspect` found for a picked element: the reply, and the locator behind each Count choice */
export interface Inspection {
  info: PickInfo & { ok: true };
  /** `counts[i]` is the locator `info.counts[i]` describes */
  counts: LocatorCall[];
}

/** Everything the controller does to the browser and the project; the recorder implements these */
export interface ControllerDeps {
  /** Sends the state to every loaded top-level document's toolbar */
  push(state: ToolbarState): void;
  reply(id: number, result: PickInfo | PageInfo | ActionReply): void;
  currentUrl(): Promise<string>;
  /** The recorded page's URL and title */
  pageInfo(): Promise<{ url: string; title: string }>;
  /** The recording's base URL: the Page panel writes URLs inside it relative to it */
  readonly baseURL?: string;
  rank(
    target: ElementHandle,
    candidates: LocatorCall[],
  ): Promise<LocatorSpec | undefined>;
  inspect(
    target: ElementHandle,
    locator: LocatorSpec,
    candidates: LocatorCall[],
  ): Promise<Inspection>;
  /** Types into the field with capture muted */
  type(locator: LocatorSpec, value: string): Promise<void>;
  mute(): Promise<void>;
  unmute(): Promise<void>;
  addVariable(name: string, value: string): Promise<void>;
  setSecret(name: string, value: string): Promise<void>;
  /** A secret was written to the project (called before its value is typed) */
  secretAdded(name: string): void;
  observe(observation: Observation): void;
  stop(): void;
  onStatus(status: { state: "recording" | "paused"; toolbar: boolean }): void;
}

export interface ControllerOptions {
  environment: string;
  canAddVariables: boolean;
  variables: Record<string, string | number | boolean>;
  /** Name → value; undefined when not set */
  secrets: Record<string, string | undefined>;
  secretsIgnored: boolean;
  /** The test's declared inputs: name → default */
  inputs?: Record<string, string>;
  /** Screenshot steps already in the test, for the default name */
  screenshots: number;
}

export type Message = ToolbarMessage & { target?: ElementHandle };
export type Of<A extends Message["action"]> = Extract<Message, { action: A }>;

/** The element picked for an Assert or Save as output, the locator behind each of its Count choices, and its text */
export interface PickState {
  id: number;
  locator: LocatorSpec;
  counts: LocatorCall[];
  /** Its text as `outputs.save` reads it, when it was picked, secrets included: it never goes back to the page */
  text: string;
}

/** The messages that expect a reply, and that a double click sends twice */
export type Replying = Of<
  "assert" | "assert-page" | "insert" | "add-insertable" | "save-output"
>;

/** What the action handlers (assert, insert, add a variable, secret or input, save as output) use of the controller */
export interface ActionContext {
  readonly deps: ControllerDeps;
  readonly options: ControllerOptions;
  readonly variables: Map<string, string>;
  readonly secrets: Map<string, string | undefined>;
  readonly inputs: Map<string, string>;
  isPaused(): boolean;
  /** The picked element an `assert` or `save-output` with the same id refers to */
  pick(): PickState | undefined;
  setPick(pick: PickState | undefined): void;
  showToast(text: string): void;
  push(): void;
}
