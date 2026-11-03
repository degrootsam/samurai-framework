import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attributeSelector,
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
    assert.equal(
      normalizeXpath("a[text()='Start']", false),
      "//a[text()='Start']",
    );
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
    assert.deepEqual(cssSelector("form input"), {
      kind: "css",
      value: "form input",
    });
    assert.deepEqual(textSelector("Sign in"), {
      kind: "text",
      value: "Sign in",
      match: "full",
      ignoreCase: false,
    });
    assert.deepEqual(
      textSelector("in", { match: "partial", ignoreCase: true }),
      {
        kind: "text",
        value: "in",
        match: "partial",
        ignoreCase: true,
      },
    );
    assert.deepEqual(roleSelector("button", { name: "Submit" }), {
      kind: "role",
      role: "button",
      name: "Submit",
    });
    assert.deepEqual(roleSelector("button"), { kind: "role", role: "button" });
  });

  it("keep today's matching by default: exact is a no-op, exact false is Playwright's", () => {
    const full = textSelector("Go");
    assert.deepEqual(textSelector("Go", { exact: true }), full);
    assert.deepEqual(textSelector("Go", { exact: false }), {
      kind: "text",
      value: "Go",
      match: "partial",
      ignoreCase: true,
    });
    assert.deepEqual(labelSelector("Go", { exact: false }), {
      kind: "label",
      value: "Go",
      match: "partial",
      ignoreCase: true,
    });
    // an explicit match or ignoreCase still wins over what exact implies
    assert.deepEqual(textSelector("Go", { exact: false, ignoreCase: false }), {
      kind: "text",
      value: "Go",
      match: "partial",
      ignoreCase: false,
    });
  });

  it("keep a RegExp as written, without g and y, whatever exact says", () => {
    assert.deepEqual(textSelector(/go/i, { exact: false }), {
      kind: "text",
      value: /go/i,
      match: "full",
      ignoreCase: false,
    });
    const kept = textSelector(/a.c/gimsy);
    assert.equal(kept.kind === "text" && (kept.value as RegExp).flags, "ims");
    assert.throws(() => textSelector(5 as never), /string or a RegExp/);
  });

  it("build attribute selectors for placeholder, alt and title", () => {
    assert.deepEqual(attributeSelector("placeholder", "Name"), {
      kind: "attribute",
      attribute: "placeholder",
      value: "Name",
      match: "full",
      ignoreCase: false,
    });
    assert.deepEqual(attributeSelector("alt", /logo/, { exact: false }), {
      kind: "attribute",
      attribute: "alt",
      value: /logo/,
      match: "full",
      ignoreCase: false,
    });
    assert.throws(() => attributeSelector("title", " "), /the title/);
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
    assert.deepEqual(toBiDiLocator(xpathSelector("h1"), false), {
      type: "xpath",
      value: "//h1",
    });
    assert.deepEqual(toBiDiLocator(xpathSelector("h1"), true), {
      type: "xpath",
      value: ".//h1",
    });
    assert.deepEqual(toBiDiLocator(cssSelector("a.b"), false), {
      type: "css",
      value: "a.b",
    });
    assert.deepEqual(
      toBiDiLocator(
        textSelector("Hi", { match: "partial", ignoreCase: true }),
        false,
      ),
      {
        type: "innerText",
        value: "Hi",
        matchType: "partial",
        ignoreCase: true,
      },
    );
    assert.deepEqual(
      toBiDiLocator(roleSelector("button", { name: "Go" }), false),
      {
        type: "accessibility",
        value: { role: "button", name: "Go" },
      },
    );
    assert.deepEqual(toBiDiLocator(roleSelector("link"), false), {
      type: "accessibility",
      value: { role: "link" },
    });
  });

  it("maps a test id to an attribute selector, escaping quotes and backslashes", () => {
    assert.deepEqual(toBiDiLocator(testIdSelector("save"), false), {
      type: "css",
      value: '[data-testid="save"]',
    });
    assert.deepEqual(toBiDiLocator(testIdSelector('a"b\\c'), true), {
      type: "css",
      value: '[data-testid="a\\"b\\\\c"]',
    });
  });

  it("refuses nth, label, attribute and a RegExp text, which the browser does not know", () => {
    assert.throws(() => toBiDiLocator({ kind: "nth", index: 0 }, false), /nth/);
    assert.throws(() => toBiDiLocator(labelSelector("Email"), false), /label/);
    assert.throws(
      () => toBiDiLocator(attributeSelector("alt", "x"), false),
      /attribute/,
    );
    assert.throws(() => toBiDiLocator(textSelector(/x/), false), /RegExp text/);
  });
});

describe("describeSelector", () => {
  it("prints labels and test ids", () => {
    assert.equal(
      describeSelector(labelSelector("Email"), false),
      'label="Email"',
    );
    assert.equal(
      describeSelector(labelSelector("Em", { match: "partial" }), false),
      'label="Em" (partial)',
    );
    assert.equal(
      describeSelector(testIdSelector("save"), false),
      'testid="save"',
    );
  });

  it("prints a name for every kind", () => {
    assert.equal(describeSelector(xpathSelector("h1"), false), "//h1");
    assert.equal(describeSelector(xpathSelector("h1"), true), ".//h1");
    assert.equal(
      describeSelector(cssSelector("form input"), false),
      "css=form input",
    );
    assert.equal(
      describeSelector(textSelector("Sign in"), false),
      'text="Sign in"',
    );
    assert.equal(
      describeSelector(textSelector("in", { match: "partial" }), false),
      'text="in" (partial)',
    );
    assert.equal(
      describeSelector(
        textSelector("in", { match: "partial", ignoreCase: true }),
        false,
      ),
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
    assert.equal(
      describeSelector(roleSelector("button"), false),
      "role=button",
    );
    assert.equal(describeSelector({ kind: "nth", index: 2 }, false), "nth=2");
    assert.equal(describeSelector(textSelector(/go/i), false), "text=/go/i");
    assert.equal(
      describeSelector(labelSelector("Mail", { exact: false }), false),
      'label="Mail" (partial, ignoring case)',
    );
    assert.equal(
      describeSelector(attributeSelector("placeholder", "Name"), false),
      'placeholder="Name"',
    );
  });

  it("joins a chain with >> and scopes chained xpaths", () => {
    const chain: Selector[] = [
      xpathSelector("//form"),
      xpathSelector("input"),
      cssSelector(".x"),
    ];
    assert.equal(describeChain(chain), "//form >> .//input >> css=.x");
    assert.equal(describeChain([xpathSelector("h1")]), "//h1");
  });
});

describe("role selectors", () => {
  it("keep only the options that are not their default", () => {
    assert.deepEqual(
      roleSelector("button", { exact: true, includeHidden: false }),
      {
        kind: "role",
        role: "button",
      },
    );
    assert.deepEqual(
      roleSelector("heading", {
        name: /intro/gi,
        exact: false,
        level: 2,
        checked: "mixed",
        includeHidden: true,
        disabled: false,
      }),
      {
        kind: "role",
        role: "heading",
        name: /intro/i,
        exact: false,
        level: 2,
        checked: "mixed",
        disabled: false,
        includeHidden: true,
      },
    );
  });

  it("reject options of the wrong type", () => {
    assert.throws(
      () => roleSelector("button", { name: 3 as never }),
      /name must be a string or a RegExp/,
    );
    assert.throws(
      () => roleSelector("heading", { level: 0 }),
      /level must be a positive integer/,
    );
    assert.throws(() => roleSelector("heading", { level: 1.5 }), /level/);
    assert.throws(
      () => roleSelector("checkbox", { checked: "yes" as never }),
      /checked must be a boolean or "mixed"/,
    );
    assert.throws(
      () => roleSelector("tab", { selected: 1 as never }),
      /selected must be a boolean/,
    );
    assert.throws(
      () => roleSelector("tab", null as never),
      /options must be an object/,
    );
  });

  it("go to the browser only when it can do the whole job", () => {
    const plain = [
      roleSelector("button"),
      roleSelector("button", { name: "Go" }),
      roleSelector("button", { name: "Go", exact: true }),
    ];
    for (const selector of plain) {
      assert.equal(toBiDiLocator(selector, false).type, "accessibility");
    }
    for (const options of [
      { name: /go/ },
      { name: "go", exact: false },
      { level: 2 },
      { checked: true },
      { includeHidden: true },
    ]) {
      assert.throws(
        () => toBiDiLocator(roleSelector("button", options), false),
        /resolved by the framework/,
      );
    }
  });

  it("are described with their options", () => {
    assert.equal(
      describeSelector(
        roleSelector("heading", { name: /a/i, level: 2, exact: false }),
        false,
      ),
      "role=heading[name=/a/i, exact=false, level=2]",
    );
    assert.equal(
      describeSelector(roleSelector("tab", { selected: true }), false),
      "role=tab[selected=true]",
    );
  });
});
