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
  | { kind: "waitForNetworkIdle" }
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
}
