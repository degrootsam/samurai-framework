import { isDeepStrictEqual } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { AssertionError } from "./assertion-error.js";
import Locator from "../locator/locator.js";
import { readConfig } from "../config/config.js";

const DEFAULT_EXPECT_TIMEOUT = 5000;
const POLL_INTERVAL = 100;

/** Locator assertions still running, mapped to their matcher name */
const pendingAssertions = new Map<Promise<void>, string>();

/**
 * Returns the matcher names of locator assertions that are still running and stops
 * tracking them. The runner calls this after a test to detect a missing `await`.
 */
export function takePendingAssertions(): string[] {
  const names = [...pendingAssertions.values()];
  pendingAssertions.clear();
  return names;
}

function track(matcher: string, assertion: Promise<void>): Promise<void> {
  pendingAssertions.set(assertion, matcher);
  // Handling both outcomes also keeps an un-awaited failure from becoming an unhandled rejection
  const untrack = () => {
    pendingAssertions.delete(assertion);
  };
  assertion.then(untrack, untrack);
  return assertion;
}

export interface LocatorAssertionOptions {
  /** Time (ms) to keep retrying. Defaults to config `expect.timeout`, then 5000 */
  timeout?: number;
}

async function resolveTimeout(options?: LocatorAssertionOptions) {
  if (options?.timeout !== undefined) return options.timeout;
  return (await readConfig("expect"))?.timeout ?? DEFAULT_EXPECT_TIMEOUT;
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

  /** Re-reads the element every POLL_INTERVAL ms until `check` passes or the timeout expires */
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
        const timeout = await resolveTimeout(options);
        const start = Date.now();
        while (true) {
          const actual = await read();
          if (check(actual) !== this.negated) return;
          if (Date.now() - start >= timeout) {
            throw new AssertionError({
              matcher: name,
              expected,
              actual,
              locator: this.locator.selector,
            });
          }
          await sleep(POLL_INTERVAL);
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
