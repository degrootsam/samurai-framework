import { test } from "node:test";
import assert from "node:assert/strict";
import { expect } from "./expect.js";
import { AssertionError } from "./assertion-error.js";

/** Asserts `fn` throws an AssertionError with the given matcher/expected/actual */
function assertFails(
  fn: () => void,
  matcher: string,
  expected: unknown,
  actual: unknown,
) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof AssertionError, "expected an AssertionError");
    assert.equal(err.matcher, matcher);
    assert.deepEqual(err.expected, expected);
    assert.deepEqual(err.actual, actual);
    return true;
  });
}

test("toBe uses Object.is", () => {
  expect(1).toBe(1);
  expect(NaN).toBe(NaN);
  assertFails(() => expect(1).toBe(2), "toBe", 2, 1);
  assertFails(() => expect({ a: 1 }).toBe({ a: 1 }), "toBe", { a: 1 }, { a: 1 });
  expect(1).not.toBe(2);
  assertFails(() => expect(1).not.toBe(1), "not.toBe", 1, 1);
});

test("toEqual compares deeply", () => {
  expect({ a: [1, 2] }).toEqual({ a: [1, 2] });
  assertFails(() => expect({ a: 1 }).toEqual({ a: 2 }), "toEqual", { a: 2 }, { a: 1 });
  expect({ a: 1 }).not.toEqual({ a: 2 });
});

test("toBeTruthy / toBeFalsy", () => {
  expect(1).toBeTruthy();
  expect("").toBeFalsy();
  assertFails(() => expect(0).toBeTruthy(), "toBeTruthy", "truthy", 0);
  assertFails(() => expect("x").toBeFalsy(), "toBeFalsy", "falsy", "x");
  expect(0).not.toBeTruthy();
});

test("toContain works on arrays and strings", () => {
  expect([1, 2, 3]).toContain(2);
  expect("hello world").toContain("world");
  assertFails(() => expect([1, 2]).toContain(3), "toContain", 3, [1, 2]);
  expect("abc").not.toContain("z");
  assert.throws(() => expect(42).toContain(4), TypeError);
  assert.throws(() => expect("abc").toContain(1), TypeError);
});

test("toMatch accepts substrings and regexps", () => {
  expect("Contact us").toMatch("Contact");
  expect("Contact us").toMatch(/contact/i);
  expect("aaa").toMatch(/a/g);
  expect("aaa").toMatch(/a/g); // global regexps must not keep lastIndex state
  assertFails(() => expect("Home").toMatch(/contact/), "toMatch", /contact/, "Home");
  expect("Home").not.toMatch("Contact");
  assert.throws(() => expect(1).toMatch("1"), TypeError);
});

test("number comparisons", () => {
  expect(3).toBeGreaterThan(2);
  expect(3).toBeGreaterThanOrEqual(3);
  expect(2).toBeLessThan(3);
  expect(3).toBeLessThanOrEqual(3);
  expect(3n).toBeGreaterThan(2);
  assertFails(() => expect(2).toBeGreaterThan(3), "toBeGreaterThan", 3, 2);
  assertFails(() => expect(3).not.toBeLessThanOrEqual(3), "not.toBeLessThanOrEqual", 3, 3);
  assert.throws(() => expect("3").toBeGreaterThan(2), TypeError);
});
