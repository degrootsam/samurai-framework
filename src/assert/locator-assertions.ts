import { resolveTimeout } from "../config/timeouts.js";
import type Locator from "../locator/locator.js";
import { waitUntil, WaitTimeoutError } from "../wait/wait-until.js";
import { AssertionError } from "./assertion-error.js";
import { track } from "./pending-assertions.js";
import { classCheck, matchesText, textCheck } from "./text-match.js";

export interface LocatorAssertionOptions {
  /** Time (ms) to keep retrying. Defaults to config `expect.timeout`, then 5000 */
  timeout?: number;
}

export class LocatorAssertions {
  private readonly locator: Locator;
  private readonly negated: boolean;

  constructor(locator: Locator, negated = false) {
    this.locator = locator;
    this.negated = negated;
  }

  /** Inverts the next matcher: it retries until the condition is false */
  get not(): LocatorAssertions {
    return new LocatorAssertions(this.locator, !this.negated);
  }

  /**
   * Re-reads the element until `check` passes or the timeout expires. With `mustExist`, a read of `null`
   * (no element) never passes, with or without `.not`, and fails as "could not read"
   */
  private assertEventually<V>(
    matcher: string,
    expected: unknown,
    read: () => Promise<V>,
    check: (actual: V) => boolean,
    options?: LocatorAssertionOptions,
    mustExist = false,
  ): Promise<void> {
    const name = this.negated ? `not.${matcher}` : matcher;

    return track(
      name,
      (async () => {
        const timeout = await resolveTimeout(options?.timeout);
        try {
          await waitUntil(
            read,
            (actual) =>
              mustExist && actual === null
                ? false
                : check(actual) !== this.negated,
            { timeout },
          );
        } catch (err) {
          if (!(err instanceof WaitTimeoutError)) throw err;
          // Reads never resolve to undefined, so an undefined `last` means no read completed
          if (err.last === undefined || (mustExist && err.last === null)) {
            throw new Error(
              `expect(locator).${name}: could not read ${this.locator.selector} within ${timeout}ms`,
            );
          }
          throw new AssertionError({
            matcher: name,
            expected,
            actual: err.last,
            locator: this.locator.selector,
          });
        }
      })(),
    );
  }

  /** For matchers that need an element: `read` answers null when there is none, which never passes */
  private assertExisting<V>(
    matcher: string,
    expected: unknown,
    read: () => Promise<V | null>,
    check: (actual: V) => boolean,
    options?: LocatorAssertionOptions,
  ): Promise<void> {
    return this.assertEventually(
      matcher,
      expected,
      read,
      (actual) => actual !== null && check(actual),
      options,
      true,
    );
  }

  toBeVisible(options?: LocatorAssertionOptions) {
    return this.assertEventually(
      "toBeVisible",
      true,
      () => this.locator.isVisible(),
      (visible) => visible,
      options,
    );
  }

  /** Trimmed text content equals `expected` (string) or matches it (RegExp) */
  toHaveText(expected: string | RegExp, options?: LocatorAssertionOptions) {
    return this.assertEventually(
      "toHaveText",
      expected,
      () => this.locator.textContent(),
      textCheck(expected, "exact"),
      options,
    );
  }

  /** Text content contains `expected` (string) or matches it (RegExp) */
  toContainText(expected: string | RegExp, options?: LocatorAssertionOptions) {
    return this.assertEventually(
      "toContainText",
      expected,
      () => this.locator.textContent(),
      textCheck(expected, "contains"),
      options,
    );
  }

  toHaveValue(expected: string | RegExp, options?: LocatorAssertionOptions) {
    return this.assertEventually(
      "toHaveValue",
      expected,
      () => this.locator.inputValue(),
      textCheck(expected, "exact"),
      options,
    );
  }

  toHaveAttribute(
    name: string,
    expected: string | RegExp,
    options?: LocatorAssertionOptions,
  ) {
    return this.assertEventually(
      "toHaveAttribute",
      expected,
      () => this.locator.getAttribute(name),
      textCheck(expected, "exact"),
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
  toBeEnabled(options?: LocatorAssertionOptions) {
    return this.assertExisting(
      "toBeEnabled",
      true,
      () => this.locator.enabledState(),
      (enabled) => enabled,
      options,
    );
  }

  /** A checked checkbox or radio input, or an element with `aria-checked="true"`; a missing element never passes, not even with `.not` */
  toBeChecked(options?: LocatorAssertionOptions) {
    return this.assertExisting(
      "toBeChecked",
      true,
      () => this.locator.isChecked(),
      (checked) => checked,
      options,
    );
  }

  /** The class attribute equals `expected` (string, whitespace collapsed and trimmed on both sides) or matches it (RegExp, tested on the attribute as written) */
  toHaveClass(expected: string | RegExp, options?: LocatorAssertionOptions) {
    return this.assertExisting(
      "toHaveClass",
      expected,
      () => this.locator.classAttribute(),
      classCheck(expected),
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
}
