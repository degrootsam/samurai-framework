import { isDeepStrictEqual } from "node:util";
import { AssertionError } from "./assertion-error.js";
import { matchesText } from "./text-match.js";

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
