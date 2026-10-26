import type {
  Expectation,
  LocatorCall,
  PageExpectation,
} from "../../steps/model.js";

/** The BiDi sandbox realm the toolbar script runs in */
export const TOOLBAR_SANDBOX = "samurai-toolbar";
/** `Symbol.for(TOOLBAR_KEY)` on the sandbox global holds the toolbar's hook: `update`, `reply`, `press`, `root` */
export const TOOLBAR_KEY = "samurai.toolbar";

type MatcherChoice = Expectation["matcher"];

/** What the toolbar draws; secrets are names only */
export interface ToolbarState {
  status: "recording" | "paused";
  collapsed: boolean;
  /** Top-left corner in CSS pixels; null = the default spot (top right, 12 px in) */
  position: { x: number; y: number } | null;
  steps: number;
  environment: string;
  /** False when the config has no `environments` */
  canAddVariables: boolean;
  variables: { name: string; value: string }[];
  secrets: { name: string; set: boolean }[];
  /** The recording test's declared inputs and their defaults */
  inputs: { name: string; value: string }[];
  /** Whether `.env.<environment>` is git-ignored */
  secretsIgnored: boolean;
  /** Ask "Add a step that opens this page?" */
  resumeQuestion: boolean;
  /** Prefill for the Screenshot panel: `screenshot-<n>` */
  nextScreenshot: string;
  /** Shown once per id */
  toast?: { id: number; text: string };
  /** The name of the file being saved to the project, while a transfer runs */
  saving?: string;
  /** Shown until the tester dismisses each (a file that wasn't saved) */
  warnings: { id: number; text: string }[];
}

/** Element-carrying messages send the element itself (it arrives as a handle) and its candidates */
export type ToolbarMessage = { type: "toolbar" } &
  /** `url` is the document's `location.href`; Firefox also runs the toolbar in a transient about:blank */
  (
    | { action: "ready"; url?: string }
    | { action: "pause" }
    | { action: "resume" }
    | { action: "resume-goto"; add: boolean }
    | { action: "stop" }
    | { action: "move"; x: number; y: number }
    | { action: "collapse"; collapsed: boolean }
    | { action: "dismiss"; id: number }
    | { action: "pick"; id: number; target: unknown; candidates: LocatorCall[] }
    | {
        action: "assert";
        id: number;
        target: unknown;
        candidates: LocatorCall[];
        matcher: MatcherChoice;
        expected?: string;
        attribute?: string;
        /** The property Has CSS reads, as typed */
        cssName?: string;
        countIndex?: number;
        not: boolean;
      }
    | {
        action: "insert";
        id: number;
        target: unknown;
        candidates: LocatorCall[];
        kind: "env" | "secret" | "input";
        name: string;
      }
    | {
        action: "add-insertable";
        id: number;
        target: unknown;
        candidates: LocatorCall[];
        kind: "env" | "secret" | "input";
        name: string;
        value: string;
      }
    /** Save as output for the element picked with the same id; `pattern` is a RegExp's source, no flags */
    | {
        action: "save-output";
        id: number;
        target: unknown;
        candidates: LocatorCall[];
        name: string;
        pattern?: string;
      }
    /** The Page panel opened: answered with a `PageInfo` */
    | { action: "page-info"; id: number }
    | {
        action: "assert-page";
        id: number;
        matcher: PageExpectation["matcher"];
        expected: string;
        not: boolean;
      }
    | { action: "wait"; kind: "idle" }
    | { action: "wait"; kind: "time"; ms: number }
    | { action: "screenshot"; name: string; fullPage: boolean }
  );

/** The answer to `pick` */
export type PickInfo =
  | {
      ok: true;
      label: string;
      /** Whitespace collapsed and trimmed, cut at 4 KB: what the Assert panel shows and prefills */
      text: string;
      /** The whole text as `outputs.save` reads it (`textContent`, trimmed): what Save as output captures from */
      outputText: string;
      value?: string;
      attributes: { name: string; value: string }[];
      first: { matcher: MatcherChoice; expected?: string };
      counts: { label: string; count: number }[];
      /** A checkbox or radio input, or role checkbox/radio/switch, or `aria-checked`: Checked is offered */
      checkable: boolean;
      /** A form control or button, or `aria-disabled`: Enabled is offered */
      disableable: boolean;
      /** The class attribute as written; null when there is none (Has class is not offered) */
      className: string | null;
      /** Has CSS's first property and its computed value */
      css: { name: string; value: string };
    }
  | { ok: false; error: string };

/** The answer to `page-info`: the recorded page's URL, the URL the Page panel prefills, and its title */
export type PageInfo =
  | { ok: true; url: string; urlPrefill: string; title: string }
  | { ok: false; error: string };

/** The answer to `insert`, `add-insertable`, `assert`, `assert-page` and `save-output` */
export type ActionReply =
  { ok: true } | { ok: false; error: string; field?: "name" };
