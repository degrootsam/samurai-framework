import type { Modifier } from "../types/test.js";

/** One call of a locator expression, as written in a spec: `page.getByRole("button", { name: "Save" })` */
export type LocatorCall =
  | { method: "locator"; xpath: string }
  | { method: "getByCss"; css: string }
  | {
      method: "getByText";
      text: string;
      match?: "full" | "partial";
      ignoreCase?: boolean;
    }
  | {
      method: "getByLabel";
      text: string;
      match?: "full" | "partial";
      ignoreCase?: boolean;
    }
  | { method: "getByRole"; role: string; name?: string }
  | { method: "getByTestId"; testId: string };

/** A chain of locator calls on `page`, and the locators `withFallbacks` falls back to, most preferred first */
export interface LocatorSpec {
  chain: LocatorCall[];
  fallbacks: LocatorCall[][];
}

/** A text to type or compare with */
export type TextValue =
  | { kind: "literal"; value: string }
  | { kind: "env"; name: string }
  | { kind: "secret"; name: string };

/** What an assertion expects of text: a string or a regular expression */
export type TextMatcher = string | { regex: { source: string; flags: string } };

export type Expectation =
  | { matcher: "toBeVisible" }
  | {
      matcher: "toHaveText" | "toContainText" | "toHaveValue";
      expected: TextMatcher;
    }
  | { matcher: "toHaveAttribute"; name: string; expected: TextMatcher }
  | { matcher: "toHaveCount"; expected: number };

/** A file generated when the step runs: seeded random bytes of `size`, never stored in the project */
export interface GeneratedFileSpec {
  name: string;
  /** Bytes */
  size: number;
  /** MIME type; `dropFiles` gives it to the page, `setInputFiles` gets it from the name's extension */
  type?: string;
  /** How the size is written in the source (`"60 MB"`, `1048576`); written back while it still means `size` */
  sizeSource?: string;
}

/** A file a step sets or drops: one stored in the project (relative to the project folder), or a generated one */
export type FileEntry = { path: string } | { generate: GeneratedFileSpec };

/** The restricted set of statements the recorder writes. Anything else in a test is a `custom` step */
export type Step =
  | { kind: "goto"; url: string }
  | { kind: "click"; locator: LocatorSpec }
  | { kind: "fill"; locator: LocatorSpec; value: TextValue }
  | {
      kind: "expect";
      locator: LocatorSpec;
      not: boolean;
      expectation: Expectation;
    }
  /** A key pressed while the element has focus, e.g. `Enter` to submit a field. Named as Playwright names keys */
  | { kind: "press"; locator: LocatorSpec; key: string }
  | { kind: "waitForNetworkIdle" }
  /** A fixed pause, in milliseconds */
  | { kind: "waitForTimeout"; ms: number }
  /** Saves the page as evidence under the run's results; never compares */
  | { kind: "screenshot"; name: string; fullPage: boolean }
  /** Sets the files of an `<input type=file>`; no files clears it */
  | { kind: "setInputFiles"; locator: LocatorSpec; files: FileEntry[] }
  /** Drops files on an element, as dragging them from the desktop does */
  | { kind: "dropFiles"; locator: LocatorSpec; files: FileEntry[] }
  /** A statement the codec does not understand, kept verbatim */
  | { kind: "custom"; code: string };

/** A step and where its statement sits in the source */
export interface ParsedStep {
  step: Step;
  /** Offset of the statement's first character (after leading comments) */
  start: number;
  end: number;
  /** Offset where the statement's own lines begin, leading comments included */
  anchor: number;
}

export interface ParsedTest {
  /** describe titles, then the test title */
  titlePath: string[];
  name: string;
  steps: ParsedStep[];
  /** Offset just after the `{` of the test body, and of its closing `}` */
  bodyStart: number;
  bodyEnd: number;
  /** Where the whole test starts: the full start of its statement, so the comments and blank line above are included */
  start: number;
  /** Where the whole test ends: the end of its statement, after the `;` */
  end: number;
  /**
   * The fixtures the test's callback destructures, and the offset where another one goes: after the last one
   * (`list`), inside an empty `{}` (`empty`) or inside the empty `()` of a callback without parameters (`none`).
   * Undefined when the parameter can't take one: a plain identifier, or a rest element
   */
  fixtures?: { names: string[]; at: number; shape: "list" | "empty" | "none" };
  /** `skip` or `fixme` (not run), or `only` (focused), as the runner applies it: a modifier on a `describe` counts */
  modifier?: Modifier;
  /** The `{ reason }` written with the `skip` or `fixme` that applies, when it is a string literal */
  reason?: string;
}
