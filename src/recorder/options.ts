import type { RecorderEvent } from "./normalise.js";
import type { ControllerDeps, ControllerOptions } from "./toolbar/types.js";

/** The toolbar's settings: the recording's environment, and where its variables and secrets are written */
export type ToolbarOptions = ControllerOptions & {
  /** The project folder: `samurai.config.ts` and `.env.<environment>` */
  projectDir: string;
  /**
   * Called when the recording is paused or resumed, or the toolbar fails (or comes back) on a page.
   * There is no initial call: until the first one the recording is `{ state: "recording", toolbar: true }`
   */
  onStatus?: ControllerDeps["onStatus"];
  /** A secret was saved to `.env.<environment>` from the panel (before its value is typed) */
  onSecretAdded?: (name: string) => void;
  /**
   * The toolbar's Stop; the caller then stops the recording (`recorder.stop()`), as `recordSpec` does.
   * Without it, Stop runs `recorder.stop()` itself: the toolbar goes away and nothing more is recorded, but
   * nothing tells the `page.record()` caller, so pass `onStop` to learn of it.
   */
  onStop?: () => void;
};

/** Where uploads made while recording are stored */
export interface FileRecording {
  /** The project folder */
  projectDir: string;
  /** Relative to the project folder. @default "files" */
  filesDir?: string;
  /** A file that isn't stored (over 50 MB, or unreadable): its step points at `path`, which doesn't exist */
  onMissing?: (file: MissingFile) => void;
  /** @internal Tests only: also record events no person caused (`isTrusted` false) */
  trustSynthetic?: boolean;
}

export interface MissingFile {
  /** Project-relative, as the step has it */
  path: string;
  name: string;
  size: number;
  reason: "too-big" | "unreadable";
}

export interface RecorderOptions {
  /** Called for every step the tester produces, in order. Steps get indexes from `at` on */
  onEvent: (event: RecorderEvent) => void;
  /**
   * Index the first recorded step gets: record from the middle of a test by passing the number of steps
   * before it. The page must already be in the state those steps lead to; replaying them is up to the caller.
   * @default 0
   */
  at?: number;
  /** Write the page the recording starts on as a `goto` step. Pass false when `at` > 0. @default true */
  initialGoto?: boolean;
  /** URLs inside it are written relative to it, as `page.goto` resolves them */
  baseURL?: string;
  /** Shows the recorder toolbar in the page (pause, assert, insert, wait, screenshot, stop). Without it, no toolbar */
  toolbar?: ToolbarOptions;
  /** Records uploads (file inputs and drops) into the project's files folder. Without it, uploads aren't recorded */
  files?: FileRecording;
}
