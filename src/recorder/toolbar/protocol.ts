import type { LocatorCall } from "../../steps/model.js";

/** The BiDi sandbox realm the toolbar script runs in */
export const TOOLBAR_SANDBOX = "samurai-toolbar";
/** `Symbol.for(TOOLBAR_KEY)` on the sandbox global holds the toolbar's hook: `update`, `reply`, `press`, `root` */
export const TOOLBAR_KEY = "samurai.toolbar";

export type MatcherChoice =
  | "toBeVisible"
  | "toHaveText"
  | "toContainText"
  | "toHaveValue"
  | "toHaveAttribute"
  | "toHaveCount";

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
        countIndex?: number;
        not: boolean;
      }
    | {
        action: "insert";
        id: number;
        target: unknown;
        candidates: LocatorCall[];
        kind: "env" | "secret";
        name: string;
      }
    | {
        action: "add-insertable";
        id: number;
        target: unknown;
        candidates: LocatorCall[];
        kind: "env" | "secret";
        name: string;
        value: string;
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
      text: string;
      value?: string;
      attributes: { name: string; value: string }[];
      first: { matcher: MatcherChoice; expected?: string };
      counts: { label: string; count: number }[];
    }
  | { ok: false; error: string };

/** The answer to `insert`, `add-insertable` and `assert` */
export type ActionReply =
  { ok: true } | { ok: false; error: string; field?: "name" };
