import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectorFromString } from "./selector-string.js";

describe("selectorFromString", () => {
  it("treats the Playwright xpath starts as xpath", () => {
    for (const value of [
      "//a",
      "/html/body",
      "(//a)[2]",
      "../x",
      "./x",
      ".//x",
    ]) {
      assert.equal(selectorFromString(value).kind, "xpath", value);
    }
  });

  it("strips the xpath= and css= prefixes", () => {
    assert.deepEqual(selectorFromString("xpath=a[@id='x']"), {
      kind: "xpath",
      value: "a[@id='x']",
    });
    assert.deepEqual(selectorFromString("css=input[name='x']"), {
      kind: "css",
      value: "input[name='x']",
    });
    assert.deepEqual(selectorFromString("css=//not-xpath"), {
      kind: "css",
      value: "//not-xpath",
    });
  });

  it("treats everything else as css", () => {
    for (const value of [
      "main",
      "input[name='x']",
      "a, button",
      ".card > .title",
      "#login",
      "a[href^='/docs']",
      "li:nth-child(2) a",
      "div:not(.x)",
      "ul > li:first-child",
    ]) {
      assert.equal(selectorFromString(value).kind, "css", value);
    }
  });

  it("keeps relative xpaths that cannot be css working as xpath", () => {
    for (const value of [
      "a[@id='go']",
      "button[text()='Sign in']",
      "*[local-name()='svg' and @id='icon']",
      "div/span",
      "li[2]",
      "li[last()]",
      "ancestor::div",
      "input[contains(@name, 'x')]",
    ]) {
      assert.equal(selectorFromString(value).kind, "xpath", value);
    }
  });

  it("still rejects an empty string as an empty xpath", () => {
    assert.throws(() => selectorFromString(" "), /an xpath must not be empty/);
  });
});
