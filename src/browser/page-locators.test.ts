import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { remote, stubConnector } from "../testing/stub-connector.js";
import Page from "./page.js";

function setup() {
  const stub = stubConnector(remote("text"));
  stub.nodeCounts(2);
  const page = new Page(stub.connector, "ctx", {
    network: {},
    navigation: {},
    use: {},
  } as never);
  return page;
}

const STRICT = /strict mode violation, 2 elements match/;

describe("page.setStrictSelectors and locators made earlier", () => {
  test("a locator that has not run anything yet follows the new setting", async () => {
    const page = setup();
    const made = page.locator("//li");
    page.setStrictSelectors(true);
    await assert.rejects(made.textContent(), STRICT);
  });

  test("a locator keeps the answer it got at its first action or read", async () => {
    const page = setup();
    const made = page.locator("//li");
    assert.equal(await made.textContent(), "text");
    page.setStrictSelectors(true);
    assert.equal(await made.textContent(), "text", "still not strict");
    await assert.rejects(page.locator("//li").textContent(), STRICT);
  });
});
