import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  remote,
  stubConnector,
  type StubResponse,
} from "../testing/stub-connector.js";
import type { RemoteValue } from "../types/bidi-modules/script.js";
import Locator from "./locator.js";
import { cssSelector } from "./selector.js";

interface LocateParams {
  locator: { type: string; value: unknown };
  maxNodeCount?: number;
  startNodes?: Array<{ sharedId: string }>;
}

function setup(...responses: StubResponse[]) {
  const stub = stubConnector(
    ...(responses.length ? responses : [remote(null)]),
  );
  const locates = () =>
    stub.sent
      .filter(({ method }) => method === "browsingContext.locateNodes")
      .map(({ params }) => params as LocateParams);
  const make = (...steps: Parameters<typeof cssSelector>[0][]) =>
    new Locator(steps.map(cssSelector), stub.connector, "ctx");
  /** A locator from selector strings, as `page.locator` reads them */
  const raw = (selector: string) =>
    new Locator(selector, stub.connector, "ctx");
  return { ...stub, locates, make, raw };
}

const nodes = (...ids: string[]): RemoteValue => ({
  type: "array",
  value: ids.map((sharedId) => ({ type: "node", sharedId })),
});
const ids = (found: Array<{ sharedId: string }>) =>
  found.map(({ sharedId }) => sharedId);

describe("nth, first and last", () => {
  it("nth asks the browser for no more matches than the index needs", async () => {
    const { make, locates, nodeCounts } = setup();
    nodeCounts(5);
    const found = await make("li").nth(2).elements();
    assert.deepEqual(ids(found), ["stub-node-2"]);
    assert.equal(locates()[0]!.maxNodeCount, 3);
  });

  it("first fetches one match", async () => {
    const { make, locates, nodeCounts } = setup();
    nodeCounts(5);
    const first = make("li").first();
    assert.equal(first.selector, "css=li >> nth=0");
    assert.deepEqual(ids(await first.elements()), ["stub-node-0"]);
    assert.equal(locates()[0]!.maxNodeCount, 1);
  });

  it("last and negative indexes count from the end and fetch every match", async () => {
    const { make, locates, nodeCounts } = setup();
    nodeCounts(4);
    assert.deepEqual(ids(await make("li").last().elements()), ["stub-node-3"]);
    assert.deepEqual(ids(await make("li").nth(-2).elements()), ["stub-node-2"]);
    assert.equal(locates()[0]!.maxNodeCount, undefined);
  });

  it("match nothing when out of range or empty", async () => {
    const { make, nodeCounts } = setup();
    nodeCounts(2);
    assert.equal(await make("li").nth(2).count(), 0);
    assert.equal(await make("li").nth(-3).count(), 0);
    nodeCounts(0);
    assert.equal(await make("li").first().count(), 0);
    assert.equal(await make("li").last().count(), 0);
  });

  it("reject an index that is not an integer", () => {
    const { make } = setup();
    assert.throws(
      () => make("li").nth(1.5),
      /nth\(\): index must be an integer/,
    );
    assert.throws(
      () => make("li").nth(NaN),
      /nth\(\): index must be an integer/,
    );
  });

  it("put the matches of several start nodes in document order before indexing", async () => {
    // The page answers the sort with the nodes in document order: the second start's match comes first
    const { make, locates, calls, nodeCounts } = setup(nodes("b", "a"));
    nodeCounts(2, 2);
    const found = await make("ul", "li").first().elements();
    assert.deepEqual(ids(found), ["b"]);
    assert.equal(locates()[1]!.startNodes?.length, 2);
    assert.equal(locates()[1]!.maxNodeCount, undefined);
    assert.match(calls[0]!.functionDeclaration, /compareDocumentPosition/);
  });

  it("do not sort for one start node", async () => {
    const { make, calls, nodeCounts } = setup();
    nodeCounts(1, 3);
    await make("ul", "li").nth(1).elements();
    assert.equal(calls.length, 0);
  });

  it("keep the fallbacks: each alternative gets the same index", async () => {
    const { make, locates, nodeCounts } = setup();
    nodeCounts(0, 3);
    const locator = make("#a").withFallbacks(make("#b")).nth(1);
    assert.equal(locator.selector, "css=#a >> nth=1 or css=#b >> nth=1");
    assert.deepEqual(ids(await locator.elements()), ["stub-node-1"]);
    assert.equal(locates().length, 2);
  });
});

describe("filter", () => {
  it("hasText runs one page-side test over the candidates", async () => {
    const { make, calls, nodeCounts } = setup(nodes("stub-node-1"));
    nodeCounts(3);
    const locator = make("li").filter({ hasText: "paid", hasNotText: /x/i });
    assert.equal(
      locator.selector,
      'css=li >> filter(hasText="paid", hasNotText=/x/i)',
    );
    assert.deepEqual(ids(await locator.elements()), ["stub-node-1"]);
    const [call] = calls;
    assert.match(call!.functionDeclaration, /textContent/);
    assert.deepEqual((call!.args[0] as unknown[]).length, 3);
    assert.equal(call!.args[1], "paid");
  });

  it("matches nothing when no candidate passes", async () => {
    const { make, nodeCounts } = setup(nodes());
    nodeCounts(2);
    assert.equal(await make("li").filter({ hasText: "z" }).count(), 0);
  });

  it("has searches inside each candidate with a scoped first step", async () => {
    const { make, raw, locates, nodeCounts } = setup();
    // 2 candidates: the first has a match, the second none
    nodeCounts(2, 1, 0);
    const outer = make("li").filter({ has: raw("//button") });
    const found = await outer.elements();
    assert.deepEqual(ids(found), ["stub-node-0"]);
    const [list, first, second] = locates();
    assert.deepEqual(list!.locator, { type: "css", value: "li" });
    assert.deepEqual(first!.locator, { type: "xpath", value: ".//button" });
    assert.deepEqual(first!.startNodes, [{ sharedId: "stub-node-0" }]);
    assert.deepEqual(second!.startNodes, [{ sharedId: "stub-node-1" }]);
    assert.equal(first!.maxNodeCount, 1);
  });

  it("hasNot keeps the candidates without a match", async () => {
    const { make, raw, nodeCounts } = setup();
    nodeCounts(2, 1, 0);
    const found = await make("li")
      .filter({ hasNot: raw("//button") })
      .elements();
    assert.deepEqual(ids(found), ["stub-node-1"]);
  });

  it("locator(selector, options) filters the new step", async () => {
    const { make, calls, nodeCounts } = setup(nodes("stub-node-0"));
    nodeCounts(1, 2);
    const locator = make("ul").locator("li", { hasText: "x" });
    assert.equal(locator.selector, 'css=ul >> css=li >> filter(hasText="x")');
    assert.equal(await locator.count(), 1);
    assert.equal(calls.length, 1);
  });

  it("rejects empty options, bad text and a locator with fallbacks", () => {
    const { make } = setup();
    assert.throws(() => make("li").filter({}), /filter\(\): give at least one/);
    assert.throws(
      () => make("li").filter({ hasText: 1 as unknown as string }),
      /filter\(\): hasText must be a string or a RegExp/,
    );
    assert.throws(
      () => make("li").filter({ has: make("a").withFallbacks(make("b")) }),
      /filter\(\): a locator with fallbacks \(withFallbacks\) cannot be used as has/,
    );
  });
});

describe("and and or", () => {
  it("and keeps what both match, in the first locator's order", async () => {
    const { make, locates, nodeCounts } = setup();
    nodeCounts(3, 2);
    const both = make("li").and(make(".x"));
    assert.equal(both.selector, "(css=li) and (css=.x)");
    assert.deepEqual(ids(await both.elements()), [
      "stub-node-0",
      "stub-node-1",
    ]);
    assert.deepEqual(
      locates().map(({ locator }) => locator.value),
      ["li", ".x"],
    );
  });

  it("and matches nothing when either side does", async () => {
    const { make, nodeCounts } = setup();
    nodeCounts(0, 2);
    assert.equal(await make("li").and(make(".x")).count(), 0);
    nodeCounts(2, 0);
    assert.equal(await make("li").and(make(".x")).count(), 0);
  });

  it("or joins both, once each, and has the page sort them", async () => {
    const { make, calls, nodeCounts } = setup(
      nodes("stub-node-1", "stub-node-0"),
    );
    nodeCounts(1, 2);
    const either = make("a").or(make("b"));
    assert.equal(either.selector, "(css=a) or (css=b)");
    assert.deepEqual(ids(await either.elements()), [
      "stub-node-1",
      "stub-node-0",
    ]);
    assert.deepEqual((calls[0]!.args[0] as unknown[]).length, 2);
    assert.match(calls[0]!.functionDeclaration, /compareDocumentPosition/);
  });

  it("or with a missing branch answers the other without sorting", async () => {
    const { make, calls, nodeCounts } = setup();
    nodeCounts(0, 2);
    assert.equal(await make("a").or(make("b")).count(), 2);
    nodeCounts(2, 0);
    assert.equal(await make("a").or(make("b")).count(), 2);
    assert.equal(calls.length, 0);
  });

  it("or asks each side for no more than the first match an action needs", async () => {
    const { make, locates, nodeCounts } = setup(nodes("stub-node-0"));
    nodeCounts(3, 3);
    const first = make("a").or(make("b")).first();
    await first.elements();
    assert.deepEqual(
      locates().map(({ maxNodeCount }) => maxNodeCount),
      [1, 1],
    );
  });

  it("steps after them search inside the combined matches", async () => {
    const { make, locates, nodeCounts } = setup();
    nodeCounts(1, 1, 1);
    await make("a").and(make("b")).getByCss("span").count();
    assert.deepEqual(locates()[2]!.startNodes, [{ sharedId: "stub-node-0" }]);
  });

  it("reject fallbacks and locators of another page", () => {
    const { make, raw } = setup();
    const other = new Locator([cssSelector("p")], setup().connector, "other");
    const withFallbacks = make("a").withFallbacks(make("b"));
    assert.throws(
      () => withFallbacks.and(make("c")),
      /and\(\): a locator with fallbacks \(withFallbacks\) cannot be used as an operand/,
    );
    assert.throws(
      () => make("c").or(withFallbacks),
      /or\(\): a locator with fallbacks/,
    );
    assert.throws(
      () => raw("p").and(other),
      /and\(\): the locators belong to different pages/,
    );
  });
});
