import type { NodeLocator } from "../types/bidi-modules/browsing-context.js";

/** One step of a locator. A locator is a chain of them, each searching inside the previous step's matches */
export type Selector =
  | { kind: "xpath"; value: string }
  | { kind: "css"; value: string }
  | ({ kind: "text" } & TextMatch)
  | { kind: "role"; role: string; name?: string }
  /** Form controls named by a `<label>`, `aria-labelledby` or `aria-label` whose text matches */
  | ({ kind: "label" } & TextMatch)
  /** Elements whose `placeholder`, `alt` or `title` attribute matches */
  | ({ kind: "attribute"; attribute: TextAttribute } & TextMatch)
  /** Elements whose `data-testid` attribute equals `value` */
  | { kind: "testid"; value: string }
  /** Picks the n-th (0-based) of everything the chain so far matches; a negative index counts from the end. `nth()` and `all()` build these */
  | { kind: "nth"; index: number }
  /** Keeps the elements the chain so far matched that pass every given test (see `filterSelector`) */
  | ({ kind: "filter" } & FilterTests)
  /** The elements two whole chains both match (`and`), or either matches (`or`, in document order); built by `and()` and `or()` */
  | {
      kind: "and" | "or";
      left: readonly Selector[];
      right: readonly Selector[];
    };

/** A text test of a filter: a string is a case-insensitive substring, a RegExp is tested on the element's text */
export type TextCriterion = string | RegExp;

/** The tests of a `filter` step; `has` and `hasNot` are chains searched inside each candidate */
export interface FilterTests {
  hasText?: TextCriterion;
  hasNotText?: TextCriterion;
  has?: readonly Selector[];
  hasNot?: readonly Selector[];
}

/** The attributes `getByPlaceholder`, `getByAltText` and `getByTitle` look at */
export type TextAttribute = "placeholder" | "alt" | "title";

/** What a text, label or attribute step looks for; a RegExp is tested as written (`match` and `ignoreCase` do not apply) */
interface TextMatch {
  value: string | RegExp;
  match: "full" | "partial";
  ignoreCase: boolean;
}

export interface TextOptions {
  /**
   * `true` (the default) keeps the full-string, case-sensitive match; `false` switches this call to Playwright's
   * matching: a case-insensitive substring, whitespace normalised. Does not apply to a RegExp. This is the one
   * intentional difference from Playwright, whose default is the case-insensitive substring.
   * @default true
   */
  exact?: boolean;
  /** @default "full", or "partial" with `exact: false` */
  match?: "full" | "partial";
  /** @default false, or true with `exact: false` */
  ignoreCase?: boolean;
}

/** What `getByPlaceholder`, `getByAltText` and `getByTitle` take */
export type ExactOption = Pick<TextOptions, "exact">;

function nonEmpty(value: string, what: string): string {
  if (value.trim() === "") throw new TypeError(`${what} must not be empty`);
  return value;
}

export function xpathSelector(value: string): Selector {
  return { kind: "xpath", value: nonEmpty(value, "an xpath") };
}

export function cssSelector(value: string): Selector {
  return { kind: "css", value: nonEmpty(value, "a css selector") };
}

export function nthSelector(index: number): Selector {
  if (!Number.isInteger(index)) {
    throw new TypeError(`nth(): index must be an integer, got ${index}`);
  }
  return { kind: "nth", index };
}

function textMatch(
  value: string | RegExp,
  what: string,
  { exact = true, match, ignoreCase }: TextOptions,
): TextMatch {
  if (value instanceof RegExp) {
    // The page tests it as written; g and y would make a repeated test depend on lastIndex
    const plain = new RegExp(value.source, value.flags.replace(/[gy]/g, ""));
    return { value: plain, match: "full", ignoreCase: false };
  }
  if (typeof value !== "string") {
    throw new TypeError(`${what} must be a string or a RegExp`);
  }
  return {
    value: nonEmpty(value, what),
    match: match ?? (exact ? "full" : "partial"),
    ignoreCase: ignoreCase ?? !exact,
  };
}

export function textSelector(
  value: string | RegExp,
  options: TextOptions = {},
): Selector {
  return { kind: "text", ...textMatch(value, "the text", options) };
}

export function labelSelector(
  value: string | RegExp,
  options: TextOptions = {},
): Selector {
  return { kind: "label", ...textMatch(value, "the label", options) };
}

const ATTRIBUTE_WHAT: Record<TextAttribute, string> = {
  placeholder: "the placeholder",
  alt: "the alt text",
  title: "the title",
};

export function attributeSelector(
  attribute: TextAttribute,
  value: string | RegExp,
  options: ExactOption = {},
): Selector {
  return {
    kind: "attribute",
    attribute,
    ...textMatch(value, ATTRIBUTE_WHAT[attribute], options),
  };
}

export function testIdSelector(value: string): Selector {
  return { kind: "testid", value: nonEmpty(value, "the test id") };
}

export function roleSelector(
  role: string,
  { name }: { name?: string } = {},
): Selector {
  nonEmpty(role, "the role");
  return name === undefined
    ? { kind: "role", role }
    : { kind: "role", role, name };
}

/**
 * Normalises an xpath. Relative xpaths get a leading `//` (`.//` when `scoped`, i.e. searching inside
 * a parent match). Absolute (`/…`), grouped (`(…)`) and context (`./…`) paths are kept; in a scoped
 * position `//…` is also made relative, so `parent.locator("//x")` means "x inside parent".
 */
export function normalizeXpath(xpath: string, scoped: boolean): string {
  if (scoped) {
    if (xpath.startsWith("//")) return "." + xpath;
    return /^[/(.]/.test(xpath) ? xpath : ".//" + xpath;
  }
  return /^[/(.]/.test(xpath) ? xpath : "//" + xpath;
}

/** The BiDi locator for a step. `scoped` is true for every step after the first */
export function toBiDiLocator(
  selector: Selector,
  scoped: boolean,
): NodeLocator {
  switch (selector.kind) {
    case "xpath":
      return { type: "xpath", value: normalizeXpath(selector.value, scoped) };
    case "css":
      return { type: "css", value: selector.value };
    case "text":
      if (typeof selector.value !== "string") {
        throw new Error(
          "a RegExp text is resolved by the framework, not by the browser",
        );
      }
      return {
        type: "innerText",
        value: selector.value,
        matchType: selector.match,
        ignoreCase: selector.ignoreCase,
      };
    case "role":
      return {
        type: "accessibility",
        value: {
          role: selector.role,
          ...(selector.name !== undefined && { name: selector.name }),
        },
      };
    case "testid":
      return {
        type: "css",
        value: `[data-testid="${selector.value.replace(/["\\]/g, "\\$&")}"]`,
      };
    // The locator resolves these two itself, so a chain never hands them to the browser
    case "label":
    case "attribute":
      throw new Error(
        `${selector.kind} is resolved by the framework, not by the browser`,
      );
    case "nth":
      throw new Error("nth is resolved by the framework, not by the browser");
    case "filter":
    case "and":
    case "or":
      throw new Error(
        `${selector.kind} is resolved by the framework, not by the browser`,
      );
  }
}

/** A short name for error messages */
export function describeSelector(selector: Selector, scoped: boolean): string {
  switch (selector.kind) {
    case "xpath":
      return normalizeXpath(selector.value, scoped);
    case "css":
      return `css=${selector.value}`;
    case "label":
    case "text": {
      const flags = [
        selector.match === "partial" && "partial",
        selector.ignoreCase && "ignoring case",
      ].filter(Boolean);
      return `${selector.kind}=${describeValue(selector.value)}${flags.length ? ` (${flags.join(", ")})` : ""}`;
    }
    case "attribute": {
      const flags = [
        selector.match === "partial" && "partial",
        selector.ignoreCase && "ignoring case",
      ].filter(Boolean);
      return `${selector.attribute}=${describeValue(selector.value)}${flags.length ? ` (${flags.join(", ")})` : ""}`;
    }
    case "testid":
      return `testid=${JSON.stringify(selector.value)}`;
    case "role":
      return (
        `role=${selector.role}` +
        (selector.name === undefined
          ? ""
          : `[name=${JSON.stringify(selector.name)}]`)
      );
    case "nth":
      return `nth=${selector.index}`;
    case "filter":
      return `filter(${describeFilter(selector)})`;
    case "and":
    case "or":
      return `(${describeChain(selector.left)}) ${selector.kind} (${describeChain(selector.right)})`;
  }
}

function describeValue(value: TextCriterion): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function describeFilter(tests: FilterTests): string {
  return [
    tests.hasText !== undefined && `hasText=${describeValue(tests.hasText)}`,
    tests.hasNotText !== undefined &&
      `hasNotText=${describeValue(tests.hasNotText)}`,
    tests.has && `has=${describeChain(tests.has)}`,
    tests.hasNot && `hasNot=${describeChain(tests.hasNot)}`,
  ]
    .filter(Boolean)
    .join(", ");
}

export function describeChain(chain: readonly Selector[]): string {
  return chain
    .map((selector, index) => describeSelector(selector, index > 0))
    .join(" >> ");
}
