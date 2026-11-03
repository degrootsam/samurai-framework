import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ScriptError } from "../script/call-function.js";
import { remote, stubConnector } from "../testing/stub-connector.js";
import type { StubResponse } from "../testing/stub-connector.js";
import { ActionTimeoutError } from "./action-timeout-error.js";
import Locator from "./locator.js";
import { xpathSelector } from "./selector.js";

/** Element state for an element that is attached (all `evaluate` waits for) */
const attached: StubResponse = remote({
  attached: true,
  visible: false,
  enabled: false,
  editable: false,
  box: null,
  hitTarget: null,
});

function locatorWith(...responses: StubResponse[]) {
  const stub = stubConnector(...responses);
  return {
    locator: new Locator([xpathSelector("//li")], stub.connector, "ctx"),
    ...stub,
  };
}

describe("locator.evaluate", () => {
  test("passes the element first and the argument second, and returns the result", async () => {
    const { locator, calls } = locatorWith(attached, remote("done"));
    const result = await locator.evaluate("(el, arg) => el.id + arg.suffix", {
      suffix: "!",
    });
    assert.equal(result, "done");
    const last = calls[calls.length - 1]!;
    assert.equal(last.functionDeclaration, "(el, arg) => el.id + arg.suffix");
    assert.deepEqual(last.args, [{ sharedId: "stub-node-0" }, { suffix: "!" }]);
  });

  test("a hidden element is enough: it only has to be attached", async () => {
    const { locator } = locatorWith(attached, remote(1));
    assert.equal(await locator.evaluate("(el) => 1"), 1);
  });

  test("waits for the element and times out like the other waits", async () => {
    const { locator, nodeCounts, calls } = locatorWith(attached, remote(1));
    nodeCounts(0);
    await assert.rejects(
      locator.evaluate("(el) => 1", undefined, { timeout: 150 }),
      (err: Error) => {
        assert.ok(err instanceof ActionTimeoutError);
        assert.match(err.message, /evaluate/);
        assert.match(err.message, /\/\/li/);
        return true;
      },
    );
    assert.equal(calls.length, 0, "the function never ran");
  });

  test("an element that shows up while waiting is used", async () => {
    const { locator, nodeCounts } = locatorWith(attached, remote("late"));
    nodeCounts(0, 0, 1);
    assert.equal(
      await locator.evaluate("(el) => 1", undefined, { timeout: 3000 }),
      "late",
    );
  });

  test("a strict locator throws when several elements match", async () => {
    const { locator, nodeCounts } = locatorWith(attached, remote(1));
    nodeCounts(2);
    await assert.rejects(
      locator.strict().evaluate("(el) => 1"),
      /evaluate\(\): strict mode violation, 2 elements match \/\/li/,
    );
  });

  test("a non-strict locator uses the first of several matches", async () => {
    const { locator, nodeCounts } = locatorWith(attached, remote(1));
    nodeCounts(3);
    assert.equal(await locator.evaluate("(el) => 1"), 1);
  });

  test("the page's error keeps its message", async () => {
    const { locator } = locatorWith(attached, { exception: "Error: kaboom" });
    await assert.rejects(locator.evaluate("(el) => 1"), (err: Error) => {
      assert.ok(err instanceof ScriptError);
      assert.match(err.message, /kaboom/);
      assert.doesNotMatch(err.message, /Failed to locate/);
      return true;
    });
  });

  test("an element that vanished before the call counts as missing", async () => {
    const { locator } = locatorWith(attached, { error: "no such node" });
    await assert.rejects(
      locator.evaluate("(el) => 1"),
      /Failed to locate element \/\/li/,
    );
  });
});

describe("locator.evaluateAll", () => {
  test("passes the array of every match, and the argument", async () => {
    const { locator, nodeCounts, calls } = locatorWith(remote(3));
    nodeCounts(3);
    const result = await locator.evaluateAll(
      "(els, arg) => els.length + arg",
      10,
    );
    assert.equal(result, 3);
    assert.deepEqual(calls[0]!.args, [
      [
        { sharedId: "stub-node-0" },
        { sharedId: "stub-node-1" },
        { sharedId: "stub-node-2" },
      ],
      10,
    ]);
  });

  test("passes an empty array when nothing matches, without waiting", async () => {
    const { locator, nodeCounts, calls } = locatorWith(remote(0));
    nodeCounts(0);
    const started = Date.now();
    assert.equal(await locator.evaluateAll("(els) => els.length"), 0);
    assert.ok(Date.now() - started < 1000);
    assert.deepEqual(calls[0]!.args, [[]]);
  });

  test("is not subject to strict mode", async () => {
    const { locator, nodeCounts } = locatorWith(remote(2));
    nodeCounts(2);
    assert.equal(await locator.strict().evaluateAll("(els) => els.length"), 2);
  });

  test("the page's error keeps its message", async () => {
    const { locator } = locatorWith({ exception: "Error: nope" });
    await assert.rejects(locator.evaluateAll("(els) => 1"), /nope/);
  });
});
