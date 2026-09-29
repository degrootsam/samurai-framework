import { isDeepStrictEqual } from "node:util";
import { AssertionError } from "./assertion-error.js";
import Locator from "../locator/locator.js";
import { resolveTimeout, waitUntil, WaitTimeoutError } from "../wait/wait-until.js";

/**
 * Locator assertions nobody has awaited yet that are still running or have failed,
 * mapped to their matcher name
 */
const pendingAssertions = new Map<Promise<void>, string>();

/**
 * Returns the matcher names of locator assertions that were never awaited and are
 * still running or already failed, and stops tracking them. The runner calls this
 * after a test to detect a missing `await`.
 */
export function takePendingAssertions(): string[] {
  const names = [...pendingAssertions.values()];
  pendingAssertions.clear();
  return names;
}

/**
 * Promise that stops being pending as soon as anyone subscribes to it. `await`,
 * `.catch`, `.finally`, `Promise.all` and `assert.rejects` all go through `then`
 * (`await` calls it because the constructor is not the native Promise).
 */
class TrackedAssertion extends Promise<void> {
  /** Promises derived through `then` are plain promises */
  static override get [Symbol.species]() {
    return Promise;
  }

  override then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    pendingAssertions.delete(this);
    return super.then(onfulfilled, onrejected);
  }
}

function track(matcher: string, assertion: Promise<void>): Promise<void> {
  const tracked = new TrackedAssertion((resolve, reject) => {
    assertion.then(resolve, reject);
  });
  pendingAssertions.set(tracked, matcher);
  // The native then does not count as awaiting: a pass stops tracking, a failure stays
  // tracked. Handling the rejection keeps an un-awaited failure from being unhandled.
  Promise.prototype.then.call(
    tracked,
    () => pendingAssertions.delete(tracked),
    () => {},
  );
  return tracked;
}

export interface LocatorAssertionOptions {
  /** Time (ms) to keep retrying. Defaults to config `expect.timeout`, then 5000 */
  timeout?: number;
}

function matchesText(
  actual: string,
  expected: string | RegExp,
  mode: "exact" | "contains",
) {
  // search() ignores lastIndex, so global regexps behave the same on every call
  if (expected instanceof RegExp) return actual.search(expected) !== -1;
  return mode === "exact" ? actual === expected : actual.includes(expected);
}

function isNumeric(value: unknown): value is number | bigint {
  return typeof value === "number" || typeof value === "bigint";
}

export class ValueAssertions<T> {
  private readonly actual: T;
  private readonly negated: boolean;

  constructor(actual: T, negated = false) {
    this.actual = actual;
    this.negated = negated;
  }

  /** Inverts the next matcher */
  get not(): ValueAssertions<T> {
    return new ValueAssertions(this.actual, !this.negated);
  }

  private assert(pass: boolean, matcher: string, expected: unknown) {
    if (pass !== this.negated) return;
    throw new AssertionError({
      matcher: this.negated ? `not.${matcher}` : matcher,
      expected,
      actual: this.actual,
    });
  }

  private compare(
    matcher: string,
    expected: number | bigint,
    check: (actual: number | bigint, expected: number | bigint) => boolean,
  ) {
    const actual = this.actual;
    if (!isNumeric(actual) || !isNumeric(expected)) {
      throw new TypeError(
        `${matcher} expects numbers, received ${typeof actual} and ${typeof expected}`,
      );
    }
    this.assert(check(actual, expected), matcher, expected);
  }

  /** Strict identity (`Object.is`) */
  toBe(expected: unknown) {
    this.assert(Object.is(this.actual, expected), "toBe", expected);
  }

  /** Deep structural equality */
  toEqual(expected: unknown) {
    this.assert(isDeepStrictEqual(this.actual, expected), "toEqual", expected);
  }

  toBeTruthy() {
    this.assert(Boolean(this.actual), "toBeTruthy", "truthy");
  }

  toBeFalsy() {
    this.assert(!this.actual, "toBeFalsy", "falsy");
  }

  /** Array includes `item`, or string contains substring `item` */
  toContain(item: unknown) {
    const actual = this.actual;
    if (typeof actual === "string") {
      if (typeof item !== "string") {
        throw new TypeError(`toContain on a string expects a string, received ${typeof item}`);
      }
      this.assert(actual.includes(item), "toContain", item);
      return;
    }
    if (Array.isArray(actual)) {
      this.assert(actual.includes(item), "toContain", item);
      return;
    }
    throw new TypeError(`toContain expects an array or string, received ${typeof actual}`);
  }

  /** String contains `pattern` (string) or matches it (RegExp) */
  toMatch(pattern: string | RegExp) {
    const actual = this.actual;
    if (typeof actual !== "string") {
      throw new TypeError(`toMatch expects a string, received ${typeof actual}`);
    }
    this.assert(matchesText(actual, pattern, "contains"), "toMatch", pattern);
  }

  toBeGreaterThan(expected: number | bigint) {
    this.compare("toBeGreaterThan", expected, (a, b) => a > b);
  }

  toBeGreaterThanOrEqual(expected: number | bigint) {
    this.compare("toBeGreaterThanOrEqual", expected, (a, b) => a >= b);
  }

  toBeLessThan(expected: number | bigint) {
    this.compare("toBeLessThan", expected, (a, b) => a < b);
  }

  toBeLessThanOrEqual(expected: number | bigint) {
    this.compare("toBeLessThanOrEqual", expected, (a, b) => a <= b);
  }
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
          await waitUntil(read, (actual) => check(actual) !== this.negated, { timeout });
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
      (text) => text !== null && matchesText(text, expected, "exact"),
      options,
    );
  }

  /** Text content contains `expected` (string) or matches it (RegExp) */
  toContainText(expected: string | RegExp, options?: LocatorAssertionOptions) {
    return this.assertEventually(
      "toContainText",
      expected,
      () => this.locator.textContent(),
      (text) => text !== null && matchesText(text, expected, "contains"),
      options,
    );
  }

  toHaveValue(expected: string | RegExp, options?: LocatorAssertionOptions) {
    return this.assertEventually(
      "toHaveValue",
      expected,
      () => this.locator.inputValue(),
      (value) => value !== null && matchesText(value, expected, "exact"),
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
      (value) => value !== null && matchesText(value, expected, "exact"),
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

/** Auto-retrying assertions on a page element */
export function expect(locator: Locator): LocatorAssertions;
/** Synchronous assertions on a plain value */
export function expect<T>(value: T): ValueAssertions<T>;
export function expect(value: unknown) {
  return value instanceof Locator
    ? new LocatorAssertions(value)
    : new ValueAssertions(value);
}
