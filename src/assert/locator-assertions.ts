import { MoreLocatorAssertions } from "./more-locator-assertions.js";
import { readCheckedState } from "./element-probes.js";
import type {
  LocatorAssertionOptions,
  TextAssertionOptions,
} from "./locator-assertion-base.js";
import { matchesText, normalizedCheck } from "./text-match.js";

export { readEventually } from "./locator-assertion-base.js";
export type {
  EventualRead,
  LocatorAssertionOptions,
  TextAssertionOptions,
} from "./locator-assertion-base.js";

export interface CheckedOptions extends LocatorAssertionOptions {
  /** The state to expect: `true` (default), `false`, or `"mixed"` (an indeterminate checkbox, or `aria-checked="mixed"`) */
  checked?: boolean | "mixed";
  /** Same as `checked: "mixed"` */
  indeterminate?: boolean;
}

export class LocatorAssertions extends MoreLocatorAssertions {
  /** Inverts the next matcher: it retries until the condition is false */
  get not(): LocatorAssertions {
    return new LocatorAssertions(this.locator, !this.negated);
  }

  /** The element exists, has a box and isn't hidden by CSS; `visible: false` expects the opposite, as `toBeHidden` */
  toBeVisible(options?: LocatorAssertionOptions & { visible?: boolean }) {
    const want = options?.visible ?? true;
    return this.assertEventually(
      "toBeVisible",
      want,
      () => this.locator.isVisible(),
      (visible) => visible === want,
      options,
    );
  }

  /**
   * Trimmed text content equals `expected` (a string, compared with whitespace collapsed on both sides) or matches it (RegExp).
   * An array expects one entry per matched element, in order, and as many entries as elements
   */
  toHaveText(
    expected: string | RegExp | Array<string | RegExp>,
    options?: TextAssertionOptions,
  ) {
    if (Array.isArray(expected))
      return this.assertTexts("toHaveText", expected, "exact", options);
    return this.assertText(
      "toHaveText",
      expected,
      () => this.locator.textContent(),
      "exact",
      options,
      true,
    );
  }

  /**
   * Text content contains `expected` (a string, compared with whitespace collapsed on both sides) or matches it (RegExp).
   * An array expects its entries, in order, in some of the matched elements (one entry per element, others may sit between)
   */
  toContainText(
    expected: string | RegExp | Array<string | RegExp>,
    options?: TextAssertionOptions,
  ) {
    if (Array.isArray(expected))
      return this.assertTexts("toContainText", expected, "contains", options);
    return this.assertText(
      "toContainText",
      expected,
      () => this.locator.textContent(),
      "contains",
      options,
      true,
    );
  }

  toHaveValue(expected: string | RegExp, options?: TextAssertionOptions) {
    return this.assertText(
      "toHaveValue",
      expected,
      () => this.locator.inputValue(),
      "exact",
      options,
    );
  }

  /** The attribute equals `expected` (string) or matches it (RegExp); with only a name (and options), that the attribute exists */
  toHaveAttribute(
    name: string,
    options?: LocatorAssertionOptions,
  ): Promise<void>;
  toHaveAttribute(
    name: string,
    expected: string | RegExp,
    options?: TextAssertionOptions,
  ): Promise<void>;
  toHaveAttribute(
    name: string,
    expectedOrOptions?: string | RegExp | LocatorAssertionOptions,
    options?: TextAssertionOptions,
  ): Promise<void> {
    if (
      typeof expectedOrOptions !== "string" &&
      !(expectedOrOptions instanceof RegExp)
    ) {
      return this.assertEventually(
        "toHaveAttribute",
        `attribute ${name} present`,
        () => this.locator.getAttribute(name),
        (value) => value !== null,
        expectedOrOptions,
      );
    }
    const expected = expectedOrOptions;
    return this.assertText(
      "toHaveAttribute",
      expected,
      () => this.locator.getAttribute(name),
      "exact",
      options,
    );
  }

  toHaveCount(expected: number, options?: LocatorAssertionOptions) {
    return this.assertEventually(
      "toHaveCount",
      expected,
      () => this.locator.count(),
      (count) => count === expected,
      options,
    );
  }

  /** The element is missing, or has no box or is hidden by CSS (the opposite of `toBeVisible`) */
  toBeHidden(options?: LocatorAssertionOptions) {
    return this.assertEventually(
      "toBeHidden",
      true,
      () => this.locator.isVisible(),
      (visible) => !visible,
      options,
    );
  }

  /** The element exists and is neither `:disabled` nor `aria-disabled="true"`; a missing element never passes, not even with `.not` */
  toBeEnabled(options?: LocatorAssertionOptions & { enabled?: boolean }) {
    const want = options?.enabled ?? true;
    return this.assertExisting(
      "toBeEnabled",
      want,
      () => this.locator.enabledState(),
      (enabled) => enabled === want,
      options,
    );
  }

  /** A checked checkbox or radio input, or an element with `aria-checked="true"`; a missing element never passes, not even with `.not` */
  toBeChecked(options?: CheckedOptions) {
    const want = options?.indeterminate ? "mixed" : (options?.checked ?? true);
    // Only "mixed" needs the three-state read; true and false use the plain one
    if (want === "mixed") {
      return this.assertExisting(
        "toBeChecked",
        want,
        () => readCheckedState(this.locator),
        (state) => state === "mixed",
        options,
      );
    }
    return this.assertExisting(
      "toBeChecked",
      want,
      () => this.locator.isChecked(),
      (checked) => checked === want,
      options,
    );
  }

  /** The class attribute equals `expected` (string, whitespace collapsed and trimmed on both sides) or matches it (RegExp, tested on the attribute as written) */
  toHaveClass(expected: string | RegExp, options?: LocatorAssertionOptions) {
    return this.assertExisting(
      "toHaveClass",
      expected,
      () => this.locator.classAttribute(),
      normalizedCheck(expected),
      options,
    );
  }

  /** The computed value of a CSS property equals `expected` (string) or matches it (RegExp); `name` may be camelCase (`backgroundColor`) or kebab-case, `--custom` is kept */
  toHaveCSS(
    name: string,
    expected: string | RegExp,
    options?: LocatorAssertionOptions,
  ) {
    return this.assertExisting(
      "toHaveCSS",
      expected,
      () => this.locator.cssValue(name),
      (actual) => matchesText(actual, expected, "exact"),
      options,
    );
  }

  /** The accessible name equals `expected` (string, whitespace collapsed and trimmed on both sides) or matches it (RegExp, tested as written); a missing element never passes, not even with `.not` */
  toHaveAccessibleName(
    expected: string | RegExp,
    options?: LocatorAssertionOptions,
  ) {
    return this.assertExisting(
      "toHaveAccessibleName",
      expected,
      () => this.locator.accessibleName(),
      normalizedCheck(expected),
      options,
    );
  }

  /** The accessible description (`aria-describedby`, else `title` when it is not the name) equals or matches `expected`, as `toHaveAccessibleName`; "" when there is none */
  toHaveAccessibleDescription(
    expected: string | RegExp,
    options?: LocatorAssertionOptions,
  ) {
    return this.assertExisting(
      "toHaveAccessibleDescription",
      expected,
      () => this.locator.accessibleDescription(),
      normalizedCheck(expected),
      options,
    );
  }
}
