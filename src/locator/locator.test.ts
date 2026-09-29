import { test } from "node:test";
import assert from "node:assert/strict";
import Locator from "./locator.js";
import { stubConnector, type StubResponse } from "../testing/stub-connector.js";

function locatorWith(xpath: string, ...responses: StubResponse[]) {
  const { connector, expressions, sent } = stubConnector(...responses);
  return { locator: new Locator(xpath, connector, "ctx"), expressions, sent };
}

/** Fails if the evaluated script is not valid JavaScript (compiles only, never runs) */
function assertCompiles(script: string) {
  assert.doesNotThrow(() => new Function(script), script);
}

test("selector prefixes relative xpaths with // and keeps quotes as written", () => {
  const selectorOf = (xpath: string) => locatorWith(xpath, { type: "null" }).locator.selector;
  assert.equal(selectorOf("h1"), "//h1");
  assert.equal(selectorOf("//div"), "//div");
  assert.equal(selectorOf("a[text()='Start']"), "//a[text()='Start']");
  assert.equal(selectorOf("/html/body"), "/html/body");
  assert.equal(selectorOf("(//li)[2]"), "(//li)[2]");
  assert.equal(selectorOf(".//span"), ".//span");
});

test("xpaths with both quote styles produce valid JavaScript", async () => {
  const xpath = `//a[text()="Don't stop"]`;
  const { locator, expressions } = locatorWith(
    xpath,
    { type: "string", value: "Don't stop" },
    { type: "number", value: 1 },
  );
  await locator.textContent();
  await locator.count();
  await locator.click();
  for (const expression of expressions) {
    assertCompiles(expression);
  }
  assert.ok(expressions[0]!.includes(JSON.stringify(xpath)));
  assert.ok(expressions[1]!.includes(JSON.stringify(`count(${xpath})`)));
  assert.ok(expressions[2]!.includes(JSON.stringify(xpath)));
});

test("all() returns one locator per current match", async () => {
  const { locator, expressions } = locatorWith("li", { type: "number", value: 3 });
  const items = await locator.all();
  assert.deepEqual(
    items.map((item) => item.selector),
    ["(//li)[1]", "(//li)[2]", "(//li)[3]"],
  );
  assert.ok(expressions[0]!.includes(JSON.stringify("count(//li)")));
});

test("all() returns an empty array when nothing matches", async () => {
  assert.deepEqual(await locatorWith("li", { type: "number", value: 0 }).locator.all(), []);
});

test("actions on an all() item target that item", async () => {
  const { connector, expressions } = stubConnector(
    { type: "number", value: 2 },
    { type: "undefined" },
  );
  const items = await new Locator("li", connector, "ctx").all();
  await items[1]!.click();
  assert.ok(expressions[1]!.includes(JSON.stringify("(//li)[2]")));
  assert.match(expressions[1]!, /FIRST_ORDERED_NODE_TYPE/);
  assert.match(expressions[1]!, /\.click\(\)$/);
  assertCompiles(expressions[1]!);
});

const rect = { type: "string", value: JSON.stringify({ x: 0, y: 0, width: 100, height: 20 }) } as const;

/** Methods and key values sent by fill(), in order */
function fillTrace(sent: Array<{ method: string; params: unknown }>, expressions: string[]) {
  let evaluateIndex = 0;
  return sent.map(({ method, params }) => {
    if (method === "script.evaluate") return `evaluate:${expressions[evaluateIndex++]!.includes(".select()") ? "select" : "other"}`;
    const [source] = (params as { actions: Array<{ type: string; actions: Array<{ type: string; value?: string }> }> }).actions;
    if (source!.type === "key") return `keys:${source!.actions.map((a) => a.value).join("")}`;
    return source!.type;
  });
}

test("fill() selects the existing value before typing so it is replaced", async () => {
  const { locator, sent, expressions } = locatorWith("input", rect, { type: "undefined" });
  await locator.fill("abc");
  assert.deepEqual(fillTrace(sent, expressions), [
    "evaluate:other",
    "pointer",
    "none",
    "evaluate:select",
    "keys:aabbcc",
  ]);
  for (const expression of expressions) assertCompiles(expression);
});

test('fill("") clears the field with Backspace', async () => {
  const { locator, sent, expressions } = locatorWith("input", rect, { type: "undefined" });
  await locator.fill("");
  assert.deepEqual(fillTrace(sent, expressions), [
    "evaluate:other",
    "pointer",
    "none",
    "evaluate:select",
    "keys:",
  ]);
});

test("textContent returns the string, or null when the element is missing", async () => {
  const found = locatorWith("h1", { type: "string", value: "Contact" });
  assert.equal(await found.locator.textContent(), "Contact");
  assert.match(found.expressions[0]!, /\/\/h1/);
  assert.match(found.expressions[0]!, /FIRST_ORDERED_NODE_TYPE/);

  const missing = locatorWith("h1", { type: "null" });
  assert.equal(await missing.locator.textContent(), null);
});

test("inputValue returns the value, or null", async () => {
  assert.equal(
    await locatorWith("input", { type: "string", value: "test" }).locator.inputValue(),
    "test",
  );
  assert.equal(await locatorWith("input", { type: "null" }).locator.inputValue(), null);
});

test("getAttribute passes the attribute name as a JSON string", async () => {
  const { locator, expressions } = locatorWith("a", { type: "string", value: "/home" });
  assert.equal(await locator.getAttribute("href"), "/home");
  assert.match(expressions[0]!, /getAttribute\("href"\)/);
});

test("isVisible returns the boolean result", async () => {
  assert.equal(await locatorWith("div", { type: "boolean", value: true }).locator.isVisible(), true);
  assert.equal(await locatorWith("div", { type: "boolean", value: false }).locator.isVisible(), false);
});

test("count evaluates an XPath count()", async () => {
  const { locator, expressions } = locatorWith("li", { type: "number", value: 3 });
  assert.equal(await locator.count(), 3);
  assert.match(expressions[0]!, /count\(\/\/li\)/);
  assert.match(expressions[0]!, /NUMBER_TYPE/);
});

test("reads throw on an evaluate exception", async () => {
  const { locator } = locatorWith("h1[", { exception: "SyntaxError: bad xpath" });
  await assert.rejects(locator.textContent(), /Failed to locate element/);
});

test("reads reject unexpected result types", async () => {
  const { locator } = locatorWith("h1", { type: "number", value: 1 });
  await assert.rejects(locator.textContent(), /Expected a string or null/);
});
