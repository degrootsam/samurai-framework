import { test } from "node:test";
import assert from "node:assert/strict";
import { AssertionError, format, toReportValue } from "./assertion-error.js";

test("format quotes strings, prints regexps and inspects other values", () => {
  assert.equal(format("Home"), '"Home"');
  assert.equal(format(/err/i), "/err/i");
  assert.equal(format(42), "42");
  assert.equal(format(null), "null");
  assert.equal(format({ a: 1 }), "{ a: 1 }");
});

test("toReportValue stringifies regexps and keeps other values", () => {
  assert.equal(toReportValue(/err/i), "/err/i");
  assert.equal(toReportValue("Home"), "Home");
  assert.deepEqual(toReportValue({ a: 1 }), { a: 1 });
});

test("toReportValue formats values JSON cannot store", () => {
  assert.equal(toReportValue(4n), "4n");
  assert.equal(toReportValue(Symbol("id")), "Symbol(id)");
  assert.equal(typeof toReportValue(() => 1), "string");
  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;
  const stored = toReportValue(circular);
  assert.equal(typeof stored, "string");
  assert.doesNotThrow(() => JSON.stringify(stored));
  assert.deepEqual(toReportValue({ a: [1, "x"] }), { a: [1, "x"] });
  assert.equal(toReportValue(null), null);
});

test("locator assertion message includes the locator line", () => {
  const err = new AssertionError({
    matcher: "toHaveText",
    expected: "Contact",
    actual: "Home",
    locator: "//h1",
  });
  assert.ok(err instanceof Error);
  assert.equal(err.name, "AssertionError");
  assert.equal(
    err.message,
    'expect(locator).toHaveText\n  locator: //h1\n  expected: "Contact"\n  received: "Home"',
  );
  assert.equal(err.matcher, "toHaveText");
  assert.equal(err.expected, "Contact");
  assert.equal(err.actual, "Home");
  assert.equal(err.locator, "//h1");
});

test("value assertion message has no locator line", () => {
  const err = new AssertionError({ matcher: "toBe", expected: 2, actual: 1 });
  assert.equal(err.message, "expect(value).toBe\n  expected: 2\n  received: 1");
  assert.equal(err.locator, undefined);
});
