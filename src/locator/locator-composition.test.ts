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
  return { ...stub, locates, make };
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
