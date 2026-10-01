import { test } from "node:test";
import assert from "node:assert/strict";
import { toTestError } from "./test-error.js";
import { AssertionError } from "../assert/assertion-error.js";

test("AssertionError becomes an assertion error with expected/actual", () => {
  const err = new AssertionError({
    matcher: "toHaveText",
    expected: /contact/i,
    actual: "Home",
    locator: "//h1",
  });
  const result = toTestError(err);
  assert.equal(result.type, "assertion");
  assert.equal(result.message, err.message);
  assert.equal(result.stack, err.stack);
  assert.equal(result.expected, "/contact/i");
  assert.equal(result.actual, "Home");
});

test("a BigInt AssertionError can be written to the report", () => {
  const result = toTestError(new AssertionError({ matcher: "toBe", expected: 4n, actual: 3n }));
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(result.expected, "4n");
  assert.equal(result.actual, "3n");
});

test("other errors stay type error", () => {
  const err = new Error("boom");
  assert.deepEqual(toTestError(err), { message: "boom", stack: err.stack, type: "error" });
});

test("thrown strings stay type error", () => {
  assert.deepEqual(toTestError("PORT 9223 is already in use!"), {
    message: "PORT 9223 is already in use!",
    stack: undefined,
    type: "error",
  });
});
