import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { remote, stubConnector } from "../testing/stub-connector.js";
import type { StubResponse } from "../testing/stub-connector.js";
import Locator from "./locator.js";
import { xpathSelector } from "./selector.js";

function locatorWith(...responses: StubResponse[]) {
  const stub = stubConnector(...responses);
  return {
    locator: new Locator([xpathSelector("//p")], stub.connector, "ctx"),
    ...stub,
  };
}

/** Fails if the evaluated script is not valid JavaScript (compiles only, never runs) */
function assertCompiles(script: string) {
  assert.doesNotThrow(() => new Function(script), script);
}

describe("single-element reads", () => {
  test("innerText and innerHTML return the page's string, untrimmed", async () => {
    const { locator, calls } = locatorWith(
      remote("  a\nb  "),
      remote("<b>x</b> "),
    );
    assert.equal(await locator.innerText(), "  a\nb  ");
    assert.equal(await locator.innerHTML(), "<b>x</b> ");
    assert.match(calls[0]!.functionDeclaration, /innerText/);
    assert.match(calls[1]!.functionDeclaration, /innerHTML/);
    calls.forEach((call) => assertCompiles(call.functionDeclaration));
  });

  test("they answer null for a missing element, like textContent", async () => {
    const { locator, nodeCounts, calls } = locatorWith(remote("x"));
    nodeCounts(0);
    assert.equal(await locator.innerText(), null);
    assert.equal(await locator.innerHTML(), null);
    assert.equal(calls.length, 0);
  });

  test("they follow strict mode", async () => {
    const { locator, nodeCounts } = locatorWith(remote("x"));
    nodeCounts(2);
    await assert.rejects(
      locator.strict().innerText(),
      /innerText\(\): strict mode violation, 2 elements/,
    );
    await assert.rejects(
      locator.strict().innerHTML(),
      /innerHTML\(\): strict mode violation, 2 elements/,
    );
  });
});

describe("boundingBox", () => {
  test("returns x, y, width and height", async () => {
    const { locator, calls } = locatorWith(
      remote({ x: 1, y: 2, width: 30, height: 40 }),
    );
    assert.deepEqual(await locator.boundingBox(), {
      x: 1,
      y: 2,
      width: 30,
      height: 40,
    });
    assert.match(calls[0]!.functionDeclaration, /getClientRects/);
    assertCompiles(calls[0]!.functionDeclaration);
  });

  test("is null when the page says the element is not rendered", async () => {
    const { locator } = locatorWith(remote(null));
    assert.equal(await locator.boundingBox(), null);
  });

  test("is null when the element is missing", async () => {
    const { locator, nodeCounts, calls } = locatorWith(remote(null));
    nodeCounts(0);
    assert.equal(await locator.boundingBox(), null);
    assert.equal(calls.length, 0);
  });
});

describe("allTextContents and allInnerTexts", () => {
  test("read every match in one call, as the page gives them", async () => {
    const { locator, nodeCounts, calls } = locatorWith(
      remote([" a ", "b"]),
      remote(["A", "B\nC"]),
    );
    nodeCounts(2);
    assert.deepEqual(await locator.allTextContents(), [" a ", "b"]);
    assert.deepEqual(await locator.allInnerTexts(), ["A", "B\nC"]);
    assert.equal(calls.length, 2);
    assert.match(calls[0]!.functionDeclaration, /textContent/);
    assert.match(calls[1]!.functionDeclaration, /innerText/);
    assert.deepEqual((calls[0]!.args[0] as unknown[]).length, 2);
    calls.forEach((call) => assertCompiles(call.functionDeclaration));
  });

  test("answer an empty array when nothing matches, without waiting", async () => {
    const { locator, nodeCounts } = locatorWith(remote([]));
    nodeCounts(0);
    assert.deepEqual(await locator.allTextContents(), []);
    assert.deepEqual(await locator.allInnerTexts(), []);
  });

  test("are not subject to strict mode", async () => {
    const { locator, nodeCounts } = locatorWith(remote(["a", "b"]));
    nodeCounts(2);
    assert.deepEqual(await locator.strict().allTextContents(), ["a", "b"]);
  });
});
