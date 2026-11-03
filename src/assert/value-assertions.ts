import { AssertionError } from "./assertion-error.js";
import { equalsWith, subsetMatches } from "./asymmetric.js";
import { matchesText } from "./text-match.js";
import {
  callAndCatch,
  describeOutcome,
  isCloseTo,
  lengthOf,
  thrownMatches,
  type ThrowExpectation,
} from "./value-matchers.js";

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

  private assert(
    pass: boolean,
    matcher: string,
    expected: unknown,
    actual: unknown = this.actual,
  ) {
    if (pass !== this.negated) return;
    throw new AssertionError({
      matcher: this.negated ? `not.${matcher}` : matcher,
      expected,
      actual,
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

  /**
   * Deep structural equality, strict: a property that is `undefined` differs from a missing one (Jest's `toEqual`
   * ignores it). `expected` may hold asymmetric matchers (`expect.any(Number)`, ...)
   */
  toEqual(expected: unknown) {
    this.assert(equalsWith(this.actual, expected), "toEqual", expected);
  }

  /** The object has the properties of `expected` (nested objects likewise; arrays need the same length); `expected` may hold asymmetric matchers */
  toMatchObject(expected: object) {
    const actual = this.actual;
    if (typeof actual !== "object" || actual === null) {
      throw new TypeError(
        `toMatchObject expects an object, received ${actual === null ? "null" : typeof actual}`,
      );
    }
    if (typeof expected !== "object" || expected === null) {
      throw new TypeError(
        `toMatchObject expects an object to match, received ${typeof expected}`,
      );
    }
    this.assert(subsetMatches(actual, expected), "toMatchObject", expected);
  }

  /** The array has an item that `toEqual` `item` */
  toContainEqual(item: unknown) {
    const actual = this.actual;
    if (!Array.isArray(actual)) {
      throw new TypeError(
        `toContainEqual expects an array, received ${typeof actual}`,
      );
    }
    this.assert(
      actual.some((entry) => equalsWith(entry, item)),
      "toContainEqual",
      item,
    );
  }

  toBeNull() {
    this.assert(this.actual === null, "toBeNull", null);
  }

  toBeUndefined() {
    this.assert(this.actual === undefined, "toBeUndefined", undefined);
  }

  /** Anything but `undefined` (`null` is defined) */
  toBeDefined() {
    this.assert(this.actual !== undefined, "toBeDefined", "defined");
  }

  /** A string, array or array-like with this `length` */
  toHaveLength(expected: number) {
    const length = lengthOf(this.actual);
    if (length === undefined) {
      throw new TypeError(
        `toHaveLength expects a value with a length, received ${this.actual === null ? "null" : typeof this.actual}`,
      );
    }
    this.assert(length === expected, "toHaveLength", expected, length);
  }

  /** The number is within half a unit of the `digits`-th decimal (default 2) of `expected` */
  toBeCloseTo(expected: number, digits = 2) {
    const actual = this.actual;
    if (typeof actual !== "number" || typeof expected !== "number") {
      throw new TypeError(
        `toBeCloseTo expects numbers, received ${typeof actual} and ${typeof expected}`,
      );
    }
    this.assert(isCloseTo(actual, expected, digits), "toBeCloseTo", expected);
  }

  toBeInstanceOf(expected: abstract new (...args: any[]) => unknown) {
    if (typeof expected !== "function") {
      throw new TypeError(
        `toBeInstanceOf expects a class, received ${typeof expected}`,
      );
    }
    this.assert(this.actual instanceof expected, "toBeInstanceOf", expected);
  }

  /**
   * The function throws, optionally an error whose message contains a string or matches a RegExp, that is an
   * instance of a class, or whose message equals an error's. Synchronous functions only
   */
  toThrow(expected?: ThrowExpectation) {
    const fn = this.actual;
    if (typeof fn !== "function") {
      throw new TypeError(`toThrow expects a function, received ${typeof fn}`);
    }
    const outcome = callAndCatch(fn as () => unknown);
    this.assert(
      thrownMatches(outcome, expected),
      "toThrow",
      expected ?? "an error",
      describeOutcome(outcome),
    );
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
        throw new TypeError(
          `toContain on a string expects a string, received ${typeof item}`,
        );
      }
      this.assert(actual.includes(item), "toContain", item);
      return;
    }
    if (Array.isArray(actual)) {
      this.assert(actual.includes(item), "toContain", item);
      return;
    }
    throw new TypeError(
      `toContain expects an array or string, received ${typeof actual}`,
    );
  }

  /** String contains `pattern` (string) or matches it (RegExp) */
  toMatch(pattern: string | RegExp) {
    const actual = this.actual;
    if (typeof actual !== "string") {
      throw new TypeError(
        `toMatch expects a string, received ${typeof actual}`,
      );
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
