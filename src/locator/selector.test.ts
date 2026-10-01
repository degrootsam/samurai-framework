import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  labelSelector,
  testIdSelector,
  cssSelector,
  describeChain,
  describeSelector,
  normalizeXpath,
  roleSelector,
  textSelector,
  toBiDiLocator,
  xpathSelector,
  type Selector,
} from "./selector.js";

describe("normalizeXpath", () => {
  it("prefixes a relative xpath with //, keeping absolute, grouped and context paths", () => {
    assert.equal(normalizeXpath("h1", false), "//h1");
    assert.equal(normalizeXpath("//div", false), "//div");
    assert.equal(normalizeXpath("a[text()='Start']", false), "//a[text()='Start']");
    assert.equal(normalizeXpath("/html/body", false), "/html/body");
    assert.equal(normalizeXpath("(//li)[2]", false), "(//li)[2]");
    assert.equal(normalizeXpath(".//span", false), ".//span");
  });

  it("scopes a chained xpath to its parent: relative and // paths become .//", () => {
    assert.equal(normalizeXpath("input", true), ".//input");
    assert.equal(normalizeXpath("//input", true), ".//input");
    assert.equal(normalizeXpath(".//input", true), ".//input");
    assert.equal(normalizeXpath("./input", true), "./input");
    assert.equal(normalizeXpath("/html/body", true), "/html/body");
    assert.equal(normalizeXpath("(//li)[2]", true), "(//li)[2]");
  });
});

describe("selector constructors", () => {
  it("build selectors with defaults", () => {
    assert.deepEqual(xpathSelector("h1"), { kind: "xpath", value: "h1" });
    assert.deepEqual(cssSelector("form input"), { kind: "css", value: "form input" });
    assert.deepEqual(textSelector("Sign in"), {
      kind: "text",
      value: "Sign in",
      match: "full",
      ignoreCase: false,
    });
    assert.deepEqual(textSelector("in", { match: "partial", ignoreCase: true }), {
      kind: "text",
      value: "in",
      match: "partial",
      ignoreCase: true,
    });
    assert.deepEqual(roleSelector("button", { name: "Submit" }), {
      kind: "role",
      role: "button",
      name: "Submit",
    });
    assert.deepEqual(roleSelector("button"), { kind: "role", role: "button" });
  });

  it("reject empty input", () => {
    assert.throws(() => xpathSelector(""), TypeError);
    assert.throws(() => cssSelector("  "), TypeError);
    assert.throws(() => textSelector(""), TypeError);
    assert.throws(() => roleSelector(""), TypeError);
    assert.throws(() => labelSelector(" "), TypeError);
    assert.throws(() => testIdSelector(""), TypeError);
  });
});

describe("toBiDiLocator", () => {
  it("maps every kind", () => {
    assert.deepEqual(toBiDiLocator(xpathSelector("h1"), false), { type: "xpath", value: "//h1" });
    assert.deepEqual(toBiDiLocator(xpathSelector("h1"), true), { type: "xpath", value: ".//h1" });
    assert.deepEqual(toBiDiLocator(cssSelector("a.b"), false), { type: "css", value: "a.b" });
    assert.deepEqual(toBiDiLocator(textSelector("Hi", { match: "partial", ignoreCase: true }), false), {
      type: "innerText",
      value: "Hi",
      matchType: "partial",
      ignoreCase: true,
    });
    assert.deepEqual(toBiDiLocator(roleSelector("button", { name: "Go" }), false), {
      type: "accessibility",
      value: { role: "button", name: "Go" },
    });
    assert.deepEqual(toBiDiLocator(roleSelector("link"), false), {
      type: "accessibility",
      value: { role: "link" },
    });
  });

  it("maps a test id to an attribute selector, escaping quotes and backslashes", () => {
    assert.deepEqual(toBiDiLocator(testIdSelector("save"), false), { type: "css", value: '[data-testid="save"]' });
    assert.deepEqual(toBiDiLocator(testIdSelector('a"b\\c'), true), {
      type: "css",
      value: '[data-testid="a\\"b\\\\c"]',
    });
  });

  it("refuses nth and label, which the browser does not know", () => {
    assert.throws(() => toBiDiLocator({ kind: "nth", index: 0 }, false), /nth/);
    assert.throws(() => toBiDiLocator(labelSelector("Email"), false), /label/);
  });
});

describe("describeSelector", () => {
  it("prints labels and test ids", () => {
    assert.equal(describeSelector(labelSelector("Email"), false), 'label="Email"');
    assert.equal(describeSelector(labelSelector("Em", { match: "partial" }), false), 'label="Em" (partial)');
    assert.equal(describeSelector(testIdSelector("save"), false), 'testid="save"');
  });

  it("prints a name for every kind", () => {
    assert.equal(describeSelector(xpathSelector("h1"), false), "//h1");
    assert.equal(describeSelector(xpathSelector("h1"), true), ".//h1");
    assert.equal(describeSelector(cssSelector("form input"), false), "css=form input");
    assert.equal(describeSelector(textSelector("Sign in"), false), 'text="Sign in"');
    assert.equal(
      describeSelector(textSelector("in", { match: "partial" }), false),
      'text="in" (partial)',
    );
    assert.equal(
      describeSelector(textSelector("in", { match: "partial", ignoreCase: true }), false),
      'text="in" (partial, ignoring case)',
    );
    assert.equal(
      describeSelector(textSelector("in", { ignoreCase: true }), false),
      'text="in" (ignoring case)',
    );
    assert.equal(
      describeSelector(roleSelector("button", { name: "Submit" }), false),
      'role=button[name="Submit"]',
    );
    assert.equal(describeSelector(roleSelector("button"), false), "role=button");
    assert.equal(describeSelector({ kind: "nth", index: 2 }, false), "nth=2");
  });

  it("joins a chain with >> and scopes chained xpaths", () => {
    const chain: Selector[] = [xpathSelector("//form"), xpathSelector("input"), cssSelector(".x")];
    assert.equal(describeChain(chain), "//form >> .//input >> css=.x");
    assert.equal(describeChain([xpathSelector("h1")]), "//h1");
  });
});
