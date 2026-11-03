import { test } from "node:test";
import assert from "node:assert/strict";
import Locator from "./locator.js";
import { xpathSelector } from "./selector.js";
import {
  remote,
  stubConnector,
  type StubResponse,
} from "../testing/stub-connector.js";

const ready = remote({
  attached: true,
  visible: true,
  enabled: true,
  editable: false,
  box: { x: 0, y: 0, width: 10, height: 10 },
  hitTarget: null,
});

function locatorWith(...responses: StubResponse[]) {
  const stub = stubConnector(...responses);
  return {
    locator: new Locator([xpathSelector("select")], stub.connector, "ctx"),
    ...stub,
  };
}

/** The `wanted` list the page function was called with */
function wantedIn(expressions: string[]): unknown {
  const call = expressions.find((e) => e.includes("el.dispatchEvent"))!;
  const match = /\}\)\(el, (.*)\);\s*\}\n/s.exec(call);
  return JSON.parse(match![1]!);
}

test("selectOption() returns the values the page selected", async () => {
  const { locator, expressions } = locatorWith(
    ready,
    remote({ values: ["nl"] }),
  );
  assert.deepEqual(await locator.selectOption("Netherlands"), ["nl"]);
  assert.deepEqual(wantedIn(expressions), [{ any: "Netherlands" }]);
});

test("selectOption() sends strings, objects and arrays as the options wanted", async () => {
  const { locator, expressions } = locatorWith(
    ready,
    remote({ values: ["a", "b"] }),
  );
  await locator.selectOption(["a", { label: "B", index: 1 }, { value: "c" }]);
  assert.deepEqual(wantedIn(expressions), [
    { any: "a" },
    { label: "B", index: 1 },
    { value: "c" },
  ]);
});

test("selectOption() on something that is not a select throws", async () => {
  const { locator } = locatorWith(ready, remote({ notSelect: true }));
  await assert.rejects(
    locator.selectOption("a"),
    /^Error: selectOption\(\): \/\/select is not a <select>$/,
  );
});

test("selectOption() retries until the option exists, then selects it", async () => {
  const { locator } = locatorWith(
    ready,
    remote({ missing: [{ any: "a" }] }),
    remote({ values: ["a"] }),
  );
  assert.deepEqual(await locator.selectOption("a", { timeout: 3000 }), ["a"]);
});

test("selectOption() names the options that never appeared", async () => {
  const { locator } = locatorWith(ready, remote({ missing: [{ label: "x" }] }));
  await assert.rejects(
    locator.selectOption({ label: "x" }, { timeout: 250 }),
    /^Error: selectOption\(\): no option matches {"label":"x"} in \/\/select within 250ms$/,
  );
});

test("selectOption() rejects a value that is neither a string nor an object", async () => {
  const { locator } = locatorWith(ready);
  await assert.rejects(
    locator.selectOption(5 as unknown as string),
    /selectOption\(\): expected a string/,
  );
});
