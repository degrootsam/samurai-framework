import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expectationFor,
  secretNameFor,
  urlForAssertion,
} from "./expectation.js";

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

describe("urlForAssertion", () => {
  it("writes a URL on the base URL's origin as its path, query and hash", () => {
    assert.equal(
      urlForAssertion("https://x.com/checkout?a=1#b", "https://x.com"),
      "/checkout?a=1#b",
    );
  });

  it("keeps the base URL's path: the result resolves back to the URL exactly", () => {
    assert.equal(
      urlForAssertion("https://x.com/app/checkout", "https://x.com/app"),
      "/app/checkout",
    );
  });

  it("writes the root with a query as /?…", () => {
    assert.equal(
      urlForAssertion("https://x.com?a=1", "https://x.com"),
      "/?a=1",
    );
  });

  it("keeps the full URL on another origin, or without a base URL", () => {
    assert.equal(
      urlForAssertion("https://other.com/checkout", "https://x.com"),
      "https://other.com/checkout",
    );
    assert.equal(
      urlForAssertion("https://x.com/checkout", undefined),
      "https://x.com/checkout",
    );
  });

  it("keeps the full URL when the path would read as another host", () => {
    assert.equal(
      urlForAssertion("https://x.com//other.com/p", "https://x.com"),
      "https://x.com//other.com/p",
    );
  });
});
