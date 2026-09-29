import { test } from "node:test";
import assert from "node:assert/strict";
import Locator from "./locator.js";
import { stubConnector, type StubResponse } from "../testing/stub-connector.js";

function locatorWith(xpath: string, ...responses: StubResponse[]) {
  const { connector, expressions } = stubConnector(...responses);
  return { locator: new Locator(xpath, connector, "ctx"), expressions };
}

test("selector normalises the xpath", () => {
  assert.equal(locatorWith("h1", { type: "null" }).locator.selector, "//h1");
  assert.equal(locatorWith("//div", { type: "null" }).locator.selector, "//div");
  assert.equal(
    locatorWith("a[text()='Start']", { type: "null" }).locator.selector,
    '//a[text()="Start"]',
  );
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
