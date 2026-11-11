import { test } from "node:test";
import assert from "node:assert/strict";
import Locator from "./locator.js";
import { xpathSelector } from "./selector.js";
import { BiDiError } from "../transport/bidi-error.js";
import { stubConnector, type StubResponse } from "../testing/stub-connector.js";
import { beginOutputs, endOutputs } from "../wait/output-sink.js";
import {
  locatorWith,
  pointerClicks,
  state,
} from "../testing/locator-actions-support.js";

/** Helper installer that records how often it was asked to (re)install */
function fakeHelpers() {
  const log: string[] = [];
  return {
    log,
    helpers: {
      async ensureInstalled() {
        log.push("ensure");
      },
      async reinstall() {
        log.push("reinstall");
      },
    },
  };
}

function locatorWithHelpers(xpath: string, ...responses: StubResponse[]) {
  const stub = stubConnector(...responses);
  const { log, helpers } = fakeHelpers();
  return {
    locator: new Locator(
      [xpathSelector(xpath)],
      stub.connector,
      "ctx",
      helpers,
    ),
    log,
    ...stub,
  };
}

const HELPERS_MISSING: StubResponse = {
  type: "string",
  value: "samurai:helpers-missing",
};

test("with helpers the probe runs in the samurai sandbox after ensuring the install", async () => {
  const { locator, log, sent, calls } = locatorWithHelpers("button", state());
  assert.equal(await locator.isEnabled(), true);
  assert.deepEqual(log, ["ensure"]);
  const params = sent.find(({ method }) => method === "script.callFunction")!
    .params as { target: unknown };
  assert.deepEqual(params.target, { context: "ctx", sandbox: "samurai" });
  assert.match(calls[0]!.functionDeclaration, /__samurai/);
  assert.deepEqual(calls[0]!.args, [
    { sharedId: "stub-node-0" },
    { scroll: false, hitTest: false },
  ]);
});

test("without helpers the probe source is sent to the page realm as before", async () => {
  const { locator, sent, calls } = locatorWith("button", state());
  await locator.isEnabled();
  const call = sent.find(({ method }) => method === "script.callFunction")!;
  assert.deepEqual((call.params as { target: unknown }).target, {
    context: "ctx",
  });
  assert.match(calls[0]!.functionDeclaration, /^\(el, options\) =>/);
});

test("a missing helper triggers one reinstall and a retry", async () => {
  const { locator, log, expressions } = locatorWithHelpers(
    "button",
    HELPERS_MISSING,
    state(),
  );
  assert.equal(await locator.isEnabled(), true);
  assert.deepEqual(log, ["ensure", "reinstall"]);
  assert.equal(expressions.length, 2);
});

test("helpers still missing after the reinstall is an error, not a loop", async () => {
  const { locator, log, expressions } = locatorWithHelpers(
    "button",
    HELPERS_MISSING,
  );
  await assert.rejects(locator.isEnabled(), /helpers are missing/);
  assert.deepEqual(log, ["ensure", "reinstall"]);
  assert.equal(expressions.length, 2);
});

test("ensureInstalled runs once per poll, so a click polls and clicks with the same setup", async () => {
  const { locator, log, sent } = locatorWithHelpers("button", state());
  await locator.click({ timeout: 3000 });
  assert.ok(log.every((entry) => entry === "ensure"));
  assert.equal(pointerClicks(sent).length, 1);
});

test("all() items keep using the helpers", async () => {
  const stub = stubConnector(state());
  stub.nodeCounts(2, 1);
  const { log, helpers } = fakeHelpers();
  const items = await new Locator(
    [xpathSelector("li")],
    stub.connector,
    "ctx",
    helpers,
  ).all();
  await items[1]!.isEnabled();
  assert.ok(log.includes("ensure"));
  const probe = stub.sent.find(
    ({ method }) => method === "script.callFunction",
  )!;
  assert.deepEqual((probe.params as { target: unknown }).target, {
    context: "ctx",
    sandbox: "samurai",
  });
});

test("a page that is swapping documents matches nothing for now instead of failing (Chrome)", async () => {
  const { locator, failLocate } = locatorWith("button", state());
  for (const message of [
    "Cannot find context with specified id",
    "execution contexts cleared",
  ]) {
    failLocate(
      new BiDiError("browsingContext.locateNodes", "unknown error", message),
    );
    assert.equal(await locator.count(), 0, message);
  }
  failLocate(
    new BiDiError(
      "browsingContext.locateNodes",
      "unknown error",
      "something else",
    ),
  );
  await assert.rejects(locator.count(), /something else/);
});

test("fill() with output saves the typed value once it is typed", async () => {
  const sink = beginOutputs(["o"]);
  try {
    const { locator } = locatorWith("input", state(), { type: "undefined" });
    await locator.fill("ab", { output: "o" });
    assert.deepEqual(sink.values(), { o: "ab" });
  } finally {
    endOutputs();
  }
});

test("fill() with output saves nothing when the field is never actionable", async () => {
  const sink = beginOutputs(["o"]);
  try {
    const { locator } = locatorWith("input", state({ editable: false }));
    await assert.rejects(locator.fill("ab", { output: "o", timeout: 100 }));
    assert.deepEqual(sink.values(), {});
  } finally {
    endOutputs();
  }
});

test("fill() with output outside a test, or for an undeclared name, throws before touching the page", async () => {
  endOutputs();
  const { locator, sent } = locatorWith("input", state());
  await assert.rejects(locator.fill("x", { output: "o" }), {
    message: "fill(): output can only be saved inside a test",
  });
  beginOutputs(["o"]);
  try {
    await assert.rejects(locator.fill("x", { output: "z" }), {
      message: 'fill(): output "z" is not declared',
    });
  } finally {
    endOutputs();
  }
  assert.equal(sent.length, 0);
});
