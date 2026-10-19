import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expectationFor, secretNameFor } from "./expectation.js";

describe("expectationFor", () => {
  it("prefers the value of a field, then the text, then plain visibility", () => {
    assert.deepEqual(expectationFor("Hi", "a@b.c"), {
      matcher: "toHaveValue",
      expected: "a@b.c",
    });
    assert.deepEqual(expectationFor("Hi", undefined), {
      matcher: "toHaveText",
      expected: "Hi",
    });
    assert.deepEqual(expectationFor("", undefined), { matcher: "toBeVisible" });
  });

  it("cuts a long text to 100 characters and only asks that it is contained", () => {
    const long = "x".repeat(150);
    assert.deepEqual(expectationFor(long, undefined), {
      matcher: "toContainText",
      expected: "x".repeat(100),
    });
    assert.deepEqual(expectationFor("y".repeat(100), undefined), {
      matcher: "toHaveText",
      expected: "y".repeat(100),
    });
  });
});

describe("secretNameFor", () => {
  it("makes an upper snake case name from a field's name or id, and falls back to PASSWORD", () => {
    assert.equal(secretNameFor("loginPass"), "LOGIN_PASS");
    assert.equal(secretNameFor("login-pass"), "LOGIN_PASS");
    assert.equal(secretNameFor(undefined), "PASSWORD");
    assert.equal(secretNameFor("9x"), "PASSWORD");
  });
});
