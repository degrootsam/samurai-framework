import type { Modifier } from "../types/test.js";

/**
 * One call of a locator expression, as written in a spec: `page.getByRole("button", { name: "Save" })`.
 * A RegExp text or name is tested as written, so it never comes with `exact`, `match` or `ignoreCase`.
 * `nth`, `first`, `last` and `filter` narrow the calls before them, so they never start a chain
 */
export type LocatorCall =
  | { method: "locator"; xpath: string }
  | { method: "getByCss"; css: string }
  | {
      method: "getByText" | "getByLabel";
      text: TextMatcher;
      /** `false`: a case-insensitive substring. Absent: the framework's default, a full case-sensitive match */
      exact?: boolean;
      match?: "full" | "partial";
      ignoreCase?: boolean;
    }
  | {
      method: "getByPlaceholder" | "getByAltText" | "getByTitle";
      text: TextMatcher;
      exact?: boolean;
    }
  | {
      method: "getByRole";
      role: string;
      name?: TextMatcher;
      exact?: boolean;
      /** The heading level */
      level?: number;
      checked?: boolean | "mixed";
      pressed?: boolean | "mixed";
      expanded?: boolean;
      selected?: boolean;
      disabled?: boolean;
      includeHidden?: boolean;
    }
  | { method: "getByTestId"; testId: string }
  /** The n-th match, 0-based; a negative index counts from the end */
  | { method: "nth"; index: number }
  | { method: "first" }
  | { method: "last" }
  /** Keeps the matches whose text contains the string (case-insensitive) or matches the RegExp */
  | { method: "filter"; hasText: TextMatcher };

/** A chain of locator calls on `page`, and the locators `withFallbacks` falls back to, most preferred first */
export interface LocatorSpec {
  chain: LocatorCall[];
  fallbacks: LocatorCall[][];
}

/** A text to type or compare with */
export type TextValue =
  | { kind: "literal"; value: string }
  | { kind: "env"; name: string }
  | { kind: "secret"; name: string }
  /** One of the test's declared `inputs`, `inputs.name` */
  | { kind: "input"; name: string };

/** What an assertion expects of text: a string or a regular expression */
export type TextMatcher = string | { regex: { source: string; flags: string } };

export type Expectation =
  | {
      matcher:
        | "toBeVisible"
        | "toBeHidden"
        | "toBeEnabled"
        | "toBeChecked"
        | "toBeFocused"
        | "toBeDisabled"
        | "toBeEditable"
        | "toBeAttached"
        | "toBeInViewport"
        | "toBeEmpty";
    }
  | { matcher: "toHaveClass"; expected: TextMatcher }
  | { matcher: "toHaveCSS"; name: string; expected: TextMatcher }
  | {
      matcher:
        | "toHaveText"
        | "toContainText"
        | "toHaveValue"
        | "toHaveId"
        | "toHaveAccessibleName"
        | "toHaveAccessibleDescription";
      expected: TextMatcher;
    }
  | { matcher: "toHaveAttribute"; name: string; expected: TextMatcher }
  | { matcher: "toHaveCount"; expected: number };

/** What an assertion expects of the page itself: its URL or title */
export interface PageExpectation {
  matcher: "toHaveURL" | "toHaveTitle";
  expected: TextMatcher;
}

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

/**
 * The option `selectOption` chooses: a string (the option's value or its label), or exactly one of its `value`,
 * `label` or position
 */
export type SelectChoice =
  string | { value: string } | { label: string } | { index: number };

/** The restricted set of statements the recorder writes. Anything else in a test is a `custom` step */
export type Step =
  | { kind: "goto"; url: string }
  | { kind: "click"; locator: LocatorSpec }
  /** An action on an element with no argument: ticks or unticks it, moves the pointer over it, double-clicks it, empties a field */
  | {
      kind: "check" | "uncheck" | "hover" | "dblclick" | "clear";
      locator: LocatorSpec;
    }
  /** Chooses one option of a `<select>`; a list of options is `custom` */
  | { kind: "selectOption"; locator: LocatorSpec; option: SelectChoice }
  /** `output` saves the typed value as that output, `{ output: "name" }` */
  | { kind: "fill"; locator: LocatorSpec; value: TextValue; output?: string }
  | {
      kind: "expect";
      locator: LocatorSpec;
      not: boolean;
      expectation: Expectation;
      /**
       * Saves what passed as that output. Read only with `toHaveText`, `toContainText`, `toHaveValue` and
       * `toHaveAttribute`, never with `not`: any other shape is `custom`
       */
      output?: string;
    }
  /** Saves an element's text as an output, `outputs.save(name, locator, /pattern/)`: the first group, else the whole match */
  | {
      kind: "saveOutput";
      name: string;
      locator: LocatorSpec;
      pattern?: { source: string; flags: string };
    }
  /** An assertion on the page, `expect(page).toHaveURL(…)` */
  | { kind: "expectPage"; not: boolean; expectation: PageExpectation }
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
   * False when the test call isn't a statement of its own (a loop or `if` body without braces, an arrow's
   * expression body), so it can't be removed without breaking the file
   */
  removable: boolean;
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
  /** The `inputs` of the test's options object, in source order; undefined without the key */
  inputs?: TestInput[];
  /** The `outputs` of the test's options object; undefined without the key */
  outputs?: string[];
  /** The range of the test's options object (`test(title, { … }, fn)`), when it has one */
  options?: { start: number; end: number };
  /** Offset just after the title argument, where an options object goes */
  titleEnd: number;
}

/** A declared input and the value it gets when nothing supplies one */
export interface TestInput {
  name: string;
  default: string;
}

/** A `test` or `describe` call the codec can't read: its title isn't a plain string, or its function isn't written inline */
export interface UnparsedTest {
  kind: "test" | "describe";
  /** The statement's range, as for `ParsedTest` */
  start: number;
  end: number;
  /** `dynamic-options`: the options object isn't a literal the codec can read (`{ inputs: defaults }`, a variable) */
  reason: "dynamic-title" | "not-inline" | "dynamic-options";
}
