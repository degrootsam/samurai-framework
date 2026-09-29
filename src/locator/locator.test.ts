import { test } from "node:test";
import assert from "node:assert/strict";
import Locator from "./locator.js";
import { remote, stubConnector, type StubResponse } from "../testing/stub-connector.js";

function locatorWith(xpath: string, ...responses: StubResponse[]) {
  const stub = stubConnector(...responses);
  return { locator: new Locator(xpath, stub.connector, "ctx"), ...stub };
}

/** Fails if the evaluated script is not valid JavaScript (compiles only, never runs) */
function assertCompiles(script: string) {
  assert.doesNotThrow(() => new Function(script), script);
}

/** Element state for an element that is ready for any action */
const ready: StubResponse = remote({
  attached: true,
  visible: true,
  enabled: true,
  editable: true,
  box: { x: 0, y: 0, width: 100, height: 20 },
  hitTarget: "self",
});

test("selector prefixes relative xpaths with // and keeps quotes as written", () => {
  const selectorOf = (xpath: string) => locatorWith(xpath, { type: "null" }).locator.selector;
  assert.equal(selectorOf("h1"), "//h1");
  assert.equal(selectorOf("//div"), "//div");
  assert.equal(selectorOf("a[text()='Start']"), "//a[text()='Start']");
  assert.equal(selectorOf("/html/body"), "/html/body");
  assert.equal(selectorOf("(//li)[2]"), "(//li)[2]");
  assert.equal(selectorOf(".//span"), ".//span");
});

/** The BiDi locators sent, in order */
function locates(sent: Array<{ method: string; params: unknown }>) {
  return sent
    .filter(({ method }) => method === "browsingContext.locateNodes")
    .map(({ params }) => (params as { locator: unknown }).locator);
}

test("the xpath reaches the browser in the locate command, byte for byte, never in a script", async () => {
  const xpath = `//a[text()="It's \\ a\nnew line"]`;
  const { locator, sent, calls } = locatorWith(xpath, { type: "string", value: "x" }, ready);
  await locator.textContent();
  await locator.click({ timeout: 3000 });
  assert.deepEqual(locates(sent)[0], { type: "xpath", value: xpath });
  for (const call of calls) {
    assert.ok(!call.functionDeclaration.includes("It's"), "the xpath must not be embedded in the source");
    assertCompiles(call.functionDeclaration);
  }
});

test("scripts receive the located element as their first argument", async () => {
  const { locator, calls } = locatorWith("h1", { type: "string", value: "x" });
  await locator.textContent();
  assert.deepEqual(calls[0]!.args[0], { sharedId: "stub-node-0" });
});

test("locating asks for references only", async () => {
  const { locator, sent } = locatorWith("h1", { type: "null" });
  await locator.textContent();
  const params = sent[0]!.params as { serializationOptions: unknown; maxNodeCount: unknown; context: string };
  assert.deepEqual(params.serializationOptions, { maxDomDepth: 0 });
  assert.equal(params.maxNodeCount, 1);
  assert.equal(params.context, "ctx");
});

test("all() returns one locator per current match", async () => {
  const { locator, nodeCounts, sent } = locatorWith("li", { type: "null" });
  nodeCounts(3);
  const items = await locator.all();
  assert.deepEqual(
    items.map((item) => item.selector),
    ["(//li)[1]", "(//li)[2]", "(//li)[3]"],
  );
  assert.equal((sent[0]!.params as { maxNodeCount?: number }).maxNodeCount, undefined);
});

test("all() returns an empty array when nothing matches", async () => {
  const { locator, nodeCounts } = locatorWith("li", { type: "null" });
  nodeCounts(0);
  assert.deepEqual(await locator.all(), []);
});

test("actions on an all() item target that item", async () => {
  const stub = stubConnector(ready);
  stub.nodeCounts(2, 1);
  const items = await new Locator("li", stub.connector, "ctx").all();
  await items[1]!.click({ timeout: 3000 });
  assert.deepEqual(locates(stub.sent)[1], { type: "xpath", value: "(//li)[2]" });
  assert.equal(stub.sent.filter(({ method }) => method === "input.performActions").length, 1);
});

/** Methods and key values sent by fill(), in order */
function fillTrace(sent: Array<{ method: string; params: unknown }>, expressions: string[]) {
  let evaluateIndex = 0;
  return sent
    .filter(({ method }) => method !== "browsingContext.locateNodes")
    .map(({ method, params }) => {
    if (method === "script.callFunction") return `evaluate:${expressions[evaluateIndex++]!.includes(".select()") ? "select" : "other"}`;
    const [source] = (params as { actions: Array<{ type: string; actions: Array<{ type: string; value?: string }> }> }).actions;
    if (source!.type === "key") return `keys:${source!.actions.map((a) => a.value).join("")}`;
    return source!.type;
  });
}

test("fill() selects the existing value before typing so it is replaced", async () => {
  const { locator, sent, expressions } = locatorWith("input", ready, { type: "undefined" });
  await locator.fill("abc", { timeout: 3000 });
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
  const { locator, sent, expressions } = locatorWith("input", ready, { type: "undefined" });
  await locator.fill("", { timeout: 3000 });
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
  assert.deepEqual(locates(found.sent)[0], { type: "xpath", value: "//h1" });

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

test("getAttribute passes the attribute name as an argument", async () => {
  const { locator, calls } = locatorWith("a", { type: "string", value: "/home" });
  assert.equal(await locator.getAttribute("href"), "/home");
  assert.deepEqual(calls[0]!.args, [{ sharedId: "stub-node-0" }, "href"]);
  assert.match(calls[0]!.functionDeclaration, /el\.getAttribute\(name\)/);
});

test("isVisible returns the boolean result", async () => {
  assert.equal(await locatorWith("div", { type: "boolean", value: true }).locator.isVisible(), true);
  assert.equal(await locatorWith("div", { type: "boolean", value: false }).locator.isVisible(), false);
});

test("count is the number of located nodes, found without running any script", async () => {
  const { locator, nodeCounts, expressions, sent } = locatorWith("li", { type: "null" });
  nodeCounts(3);
  assert.equal(await locator.count(), 3);
  assert.equal(expressions.length, 0);
  assert.deepEqual(locates(sent), [{ type: "xpath", value: "//li" }]);
});

test("reads throw on an evaluate exception", async () => {
  const { locator } = locatorWith("h1[", { exception: "SyntaxError: bad xpath" });
  await assert.rejects(locator.textContent(), /Failed to locate element/);
});

test("reads reject unexpected result types", async () => {
  const { locator } = locatorWith("h1", { type: "number", value: 1 });
  await assert.rejects(locator.textContent(), /Expected a string or null/);
});
