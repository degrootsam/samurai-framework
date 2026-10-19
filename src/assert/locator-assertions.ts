import { resolveTimeout } from "../config/timeouts.js";
import type Locator from "../locator/locator.js";
import { waitUntil, WaitTimeoutError } from "../wait/wait-until.js";
import { AssertionError } from "./assertion-error.js";
import { track } from "./pending-assertions.js";
import { textCheck } from "./text-match.js";

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

  /** Re-reads the element until `check` passes or the timeout expires */
  private assertEventually<V>(
    matcher: string,
    expected: unknown,
    read: () => Promise<V>,
    check: (actual: V) => boolean,
    options?: LocatorAssertionOptions,
  ): Promise<void> {
    const name = this.negated ? `not.${matcher}` : matcher;

    return track(
      name,
      (async () => {
        const timeout = await resolveTimeout(options?.timeout);
        try {
          await waitUntil(read, (actual) => check(actual) !== this.negated, {
            timeout,
          });
        } catch (err) {
          if (!(err instanceof WaitTimeoutError)) throw err;
          // Reads never resolve to undefined, so an undefined `last` means no read completed
          if (err.last === undefined) {
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
}
