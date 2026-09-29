import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isExactString, matchUrl, samePattern } from "./url-match.js";

const url = "https://example.test/api/users?page=2";

describe("matchUrl", () => {
  it("a string without * must equal the URL", () => {
    assert.equal(matchUrl(url, url), true);
    assert.equal(matchUrl("https://example.test/api/users", url), false);
    assert.equal(matchUrl(url, "https://example.test/api/users?page=3"), false);
  });

  it("** matches anything, also across slashes", () => {
    assert.equal(matchUrl("**/api/users*", url), true);
    assert.equal(matchUrl("https://example.test/**", url), true);
    assert.equal(matchUrl("**", url), true);
    assert.equal(matchUrl("**/nope", url), false);
  });

  it("* matches anything but a slash", () => {
    assert.equal(matchUrl("https://example.test/api/*", "https://example.test/api/users"), true);
    assert.equal(matchUrl("https://example.test/api/*", "https://example.test/api/users/1"), false);
    assert.equal(matchUrl("https://*.test/api/users", "https://example.test/api/users"), true);
    assert.equal(matchUrl("https://example.test/api/*?page=2", url.replace("users", "x")), true);
  });

  it("the rest of a glob is literal, regex characters included", () => {
    assert.equal(matchUrl("https://example.test/a.b/*", "https://example.test/a.b/c"), true);
    assert.equal(matchUrl("https://example.test/a.b/*", "https://example.test/aXb/c"), false);
    assert.equal(matchUrl("**/(x)+[y]?*", "https://e.test/(x)+[y]?z"), true);
  });

  it("a glob matches the whole URL, not a part", () => {
    assert.equal(matchUrl("*/users", url), false);
    assert.equal(matchUrl("**/users", url), false, "the query string is part of the URL");
  });

  it("a RegExp is tested against the URL", () => {
    assert.equal(matchUrl(/\/api\/users/, url), true);
    assert.equal(matchUrl(/^https:\/\/other/, url), false);
    assert.equal(matchUrl(/\.(png|jpg)$/, "https://e.test/a.png"), true);
  });

  it("a global RegExp gives the same answer every time", () => {
    const pattern = /users/g;
    assert.equal(matchUrl(pattern, url), true);
    assert.equal(matchUrl(pattern, url), true);
    assert.equal(matchUrl(pattern, url), true);
  });
});

describe("isExactString", () => {
  it("is true for a string without *", () => {
    assert.equal(isExactString("https://e.test/x"), true);
    assert.equal(isExactString("https://e.test/*"), false);
    assert.equal(isExactString(/x/), false);
  });
});

describe("samePattern", () => {
  it("compares strings by value and RegExps by source and flags", () => {
    assert.equal(samePattern("a", "a"), true);
    assert.equal(samePattern("a", "b"), false);
    assert.equal(samePattern(/a/i, /a/i), true);
    assert.equal(samePattern(/a/i, /a/), false);
    assert.equal(samePattern(/a/, "a"), false);
  });
});
