import { isDeepStrictEqual } from "node:util";
import { track } from "./pending-assertions.js";
import {
  LocatorAssertionBase,
  readEventually,
  type LocatorAssertionOptions,
  type TextAssertionOptions,
} from "./locator-assertion-base.js";
import {
  readEmpty,
  readFocused,
  readId,
  readJSProperty,
  readViewportRatio,
} from "./element-probes.js";
import { matchesText } from "./text-match.js";

/** Floating point slack when a ratio is compared */
const RATIO_EPSILON = 1e-6;

export interface InViewportOptions extends LocatorAssertionOptions {
  /** The least share (0 to 1) of the element that must be inside the viewport. Default: any part */
  ratio?: number;
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

/** One text expectation against one element's text: a string after normalising both, a RegExp as written (trimmed text) */
function textMatches(
  actual: string,
  expected: string | RegExp,
  mode: "exact" | "contains",
): boolean {
  if (expected instanceof RegExp) return matchesText(actual, expected, mode);
  return matchesText(normalize(actual), normalize(expected), mode);
}

/** Whether `texts` (one per element) satisfy `expected`: all in order for "exact", in order but not necessarily adjacent for "contains" */
function arrayTextMatches(
  texts: string[],
  expected: Array<string | RegExp>,
  mode: "exact" | "contains",
): boolean {
  if (mode === "exact") {
    return (
      texts.length === expected.length &&
      expected.every((item, i) => textMatches(texts[i]!, item, "exact"))
    );
  }
  let next = 0;
  for (const text of texts) {
    if (
      next < expected.length &&
      textMatches(text, expected[next]!, "contains")
    )
      next++;
  }
  return next === expected.length;
}

/** The locator matchers that read the element with a small script of their own; `LocatorAssertions` adds the rest */
export class MoreLocatorAssertions extends LocatorAssertionBase {
  /** An array of texts, one entry per matched element; `read` answers the texts of every match */
  protected assertTexts(
    matcher: string,
    expected: Array<string | RegExp>,
    mode: "exact" | "contains",
    options?: TextAssertionOptions,
  ): Promise<void> {
    if (options?.output !== undefined) {
      const call = `expect(locator).${this.negated ? "not." : ""}${matcher}`;
      throw new Error(`${call}: output can’t be saved from an array of texts`);
    }
    return this.assertEventually(
      matcher,
      expected,
      async () => (await this.locator.allTextContents()).map((t) => t.trim()),
      (texts) => arrayTextMatches(texts, expected, mode),
      options,
    );
  }

  /** The element has the focus; a missing element never passes, not even with `.not` */
  toBeFocused(options?: LocatorAssertionOptions) {
    return this.assertExisting(
      "toBeFocused",
      true,
      () => readFocused(this.locator),
      (focused) => focused,
      options,
    );
  }

  /** The element's JS property `property` deep-equals `expected`; a missing element never passes, not even with `.not` */
  toHaveJSProperty(
    property: string,
    expected: unknown,
    options?: LocatorAssertionOptions,
  ) {
    const name = this.matcherName("toHaveJSProperty");
    return track(
      `expect(locator).${name}()`,
      readEventually({
        name,
        locator: this.locator,
        expected,
        read: () => readJSProperty(this.locator, property),
        check: (read) =>
          isDeepStrictEqual(read?.value, expected) !== this.negated,
        timeout: options?.timeout,
        mustExist: true,
        display: (read) => read?.value,
      }).then(() => undefined),
    );
  }

  /** Part of the element (or at least `ratio` of it) is inside the viewport; a missing element never passes, not even with `.not` */
  toBeInViewport(options?: InViewportOptions) {
    const ratio = options?.ratio ?? 0;
    return this.assertExisting(
      "toBeInViewport",
      ratio > 0 ? `ratio >= ${ratio}` : "ratio > 0",
      () => readViewportRatio(this.locator),
      (actual) => (ratio > 0 ? actual >= ratio - RATIO_EPSILON : actual > 0),
      options,
    );
  }

  /** At least one element matches (`attached: false`, or `.not`, means none does) */
  toBeAttached(options?: LocatorAssertionOptions & { attached?: boolean }) {
    const want = options?.attached ?? true;
    return this.assertEventually(
      "toBeAttached",
      want,
      async () => (await this.locator.count()) > 0,
      (attached) => attached === want,
      options,
    );
  }

  /** The element is disabled (the opposite of `toBeEnabled`); a missing element never passes, not even with `.not` */
  toBeDisabled(options?: LocatorAssertionOptions) {
    return this.assertExisting(
      "toBeDisabled",
      true,
      () => this.locator.enabledState(),
      (enabled) => !enabled,
      options,
    );
  }

  /** The element accepts typing (`editable: false` expects the opposite); a missing element never passes, not even with `.not` */
  toBeEditable(options?: LocatorAssertionOptions & { editable?: boolean }) {
    const want = options?.editable ?? true;
    return this.assertExisting(
      "toBeEditable",
      want,
      async () =>
        (await this.locator.count()) === 0
          ? null
          : await this.locator.isEditable(),
      (editable) => editable === want,
      options,
    );
  }

  /** The `id` equals `expected` (string) or matches it (RegExp); a missing element never passes, not even with `.not` */
  toHaveId(expected: string | RegExp, options?: LocatorAssertionOptions) {
    return this.assertExisting(
      "toHaveId",
      expected,
      () => readId(this.locator),
      (id) => matchesText(id, expected, "exact"),
      options,
    );
  }

  /** An input or textarea with an empty value, or any other element without element children and with no text besides whitespace; a missing element never passes, not even with `.not` */
  toBeEmpty(options?: LocatorAssertionOptions) {
    return this.assertExisting(
      "toBeEmpty",
      true,
      () => readEmpty(this.locator),
      (empty) => empty,
      options,
    );
  }
}
