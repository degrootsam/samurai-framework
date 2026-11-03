import { inspect, isDeepStrictEqual } from "node:util";
import { format } from "./assertion-error.js";

/**
 * A placeholder inside an expected value that matches a whole family of values, as in Jest and Playwright:
 * `expect(x).toEqual({ id: expect.any(Number) })`
 */
export abstract class AsymmetricMatcher {
  abstract asymmetricMatch(actual: unknown): boolean;
  abstract toString(): string;

  [inspect.custom](): string {
    return this.toString();
  }
}

class Any extends AsymmetricMatcher {
  constructor(private readonly type: unknown) {
    super();
    if (typeof type !== "function") {
      throw new TypeError("expect.any() expects a class or constructor");
    }
  }

  asymmetricMatch(actual: unknown): boolean {
    switch (this.type) {
      case String:
        return typeof actual === "string" || actual instanceof String;
      case Number:
        return typeof actual === "number" || actual instanceof Number;
      case Boolean:
        return typeof actual === "boolean" || actual instanceof Boolean;
      case BigInt:
        return typeof actual === "bigint";
      case Symbol:
        return typeof actual === "symbol";
      case Function:
        return typeof actual === "function";
      case Object:
        return typeof actual === "object" && actual !== null;
    }
    return actual instanceof (this.type as new (...args: never[]) => unknown);
  }

  toString(): string {
    return `Any<${(this.type as { name: string }).name}>`;
  }
}

class Anything extends AsymmetricMatcher {
  asymmetricMatch(actual: unknown): boolean {
    return actual !== null && actual !== undefined;
  }

  toString(): string {
    return "Anything";
  }
}

class StringContaining extends AsymmetricMatcher {
  constructor(private readonly part: string) {
    super();
  }

  asymmetricMatch(actual: unknown): boolean {
    return typeof actual === "string" && actual.includes(this.part);
  }

  toString(): string {
    return `StringContaining ${format(this.part)}`;
  }
}

class StringMatching extends AsymmetricMatcher {
  private readonly pattern: RegExp;

  constructor(pattern: string | RegExp) {
    super();
    this.pattern = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  }

  asymmetricMatch(actual: unknown): boolean {
    // search() ignores lastIndex, so a global RegExp gives the same answer on every call
    return typeof actual === "string" && actual.search(this.pattern) !== -1;
  }

  toString(): string {
    return `StringMatching ${format(this.pattern)}`;
  }
}

class ArrayContaining extends AsymmetricMatcher {
  constructor(private readonly items: unknown[]) {
    super();
  }

  asymmetricMatch(actual: unknown): boolean {
    return (
      Array.isArray(actual) &&
      this.items.every((item) => actual.some((o) => equalsWith(o, item)))
    );
  }

  toString(): string {
    return `ArrayContaining ${format(this.items)}`;
  }
}

class ObjectContaining extends AsymmetricMatcher {
  constructor(private readonly shape: object) {
    super();
  }

  asymmetricMatch(actual: unknown): boolean {
    if (typeof actual !== "object" || actual === null) return false;
    return Object.entries(this.shape).every(
      ([key, item]) =>
        key in actual && equalsWith((actual as never)[key], item),
    );
  }

  toString(): string {
    return `ObjectContaining ${format(this.shape)}`;
  }
}

/** Matches an instance of `type` (primitives for `String`, `Number`, `Boolean`, `BigInt`, `Symbol`; any non-null object for `Object`; a function for `Function`) */
export const any = (type: unknown): AsymmetricMatcher => new Any(type);
/** Matches anything but `null` and `undefined` */
export const anything = (): AsymmetricMatcher => new Anything();
/** Matches a string that contains `part` */
export const stringContaining = (part: string): AsymmetricMatcher =>
  new StringContaining(part);
/** Matches a string that matches the RegExp (a string pattern is compiled to one) */
export const stringMatching = (pattern: string | RegExp): AsymmetricMatcher =>
  new StringMatching(pattern);
/** Matches an array that has an equal item for each of `items`, in any order and with others besides */
export const arrayContaining = (items: unknown[]): AsymmetricMatcher =>
  new ArrayContaining(items);
/** Matches an object that has each key of `shape` with an equal value, and may have others */
export const objectContaining = (shape: object): AsymmetricMatcher =>
  new ObjectContaining(shape);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Whether `value` is, or holds in arrays and plain objects, an asymmetric matcher */
function holdsMatcher(value: unknown, seen = new Set<object>()): boolean {
  if (value instanceof AsymmetricMatcher) return true;
  if (typeof value !== "object" || value === null || seen.has(value))
    return false;
  if (!Array.isArray(value) && !isPlainObject(value)) return false;
  seen.add(value);
  return Object.values(value).some((item) => holdsMatcher(item, seen));
}

/**
 * The meaning of `toEqual`: `isDeepStrictEqual` (so an `undefined` property differs from a missing one),
 * except that asymmetric matchers inside arrays and plain objects of `expected` match by their own rule
 */
export function equalsWith(actual: unknown, expected: unknown): boolean {
  if (!holdsMatcher(expected)) return isDeepStrictEqual(actual, expected);
  return walk(actual, expected, equalsWith, false);
}

/** `toMatchObject`: plain objects in `expected` need only the keys they name; arrays still need the same length */
export function subsetMatches(actual: unknown, expected: unknown): boolean {
  return walk(actual, expected, subsetMatches, true);
}

function walk(
  actual: unknown,
  expected: unknown,
  recurse: (actual: unknown, expected: unknown) => boolean,
  subset: boolean,
): boolean {
  if (expected instanceof AsymmetricMatcher)
    return expected.asymmetricMatch(actual);
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, i) => recurse(actual[i], item))
    );
  }
  if (isPlainObject(expected)) {
    if (typeof actual !== "object" || actual === null) return false;
    const keys = Object.keys(expected);
    if (subset) {
      return keys.every(
        (key) =>
          key in actual && recurse((actual as never)[key], expected[key]),
      );
    }
    return (
      Object.getPrototypeOf(actual) === Object.getPrototypeOf(expected) &&
      Object.keys(actual).length === keys.length &&
      keys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(actual, key) &&
          recurse((actual as never)[key], expected[key]),
      )
    );
  }
  return isDeepStrictEqual(actual, expected);
}
