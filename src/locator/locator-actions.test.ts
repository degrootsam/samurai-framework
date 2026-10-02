import { test } from "node:test";
import assert from "node:assert/strict";
import Locator from "./locator.js";
import { ActionTimeoutError } from "./action-timeout-error.js";
import type { ElementState } from "./element-state.js";
import {
  remote,
  stubConnector,
  type StubResponse,
} from "../testing/stub-connector.js";

const BOX = { x: 10, y: 20, width: 100, height: 40 };

/** Element state response; defaults describe an element ready for any action */
function state(overrides: Partial<ElementState> = {}): StubResponse {
  return remote({
    attached: true,
    visible: true,
    enabled: true,
    editable: true,
    box: BOX,
    hitTarget: "self",
    ...overrides,
  });
}

const detached = state({
  attached: false,
  visible: false,
  enabled: false,
  editable: false,
  box: null,
  hitTarget: null,
});

function locatorWith(xpath: string, ...responses: StubResponse[]) {
  const stub = stubConnector(...responses);
  return { locator: new Locator(xpath, stub.connector, "ctx"), ...stub };
}

type Performed = {
  actions: Array<{
    type: string;
    actions: Array<{ type: string; x?: number; y?: number; value?: string }>;
  }>;
};
type Sent = Array<{ method: string; params: unknown }>;

function performed(sent: Sent, sourceType: string) {
  return sent
    .filter(({ method }) => method === "input.performActions")
    .map(({ params }) => (params as Performed).actions[0]!)
    .filter((source) => source.type === sourceType);
}

/** [x, y] of the pointerMove of every pointer click sent */
function pointerClicks(sent: Sent) {
  return performed(sent, "pointer").map((source) => [
    source.actions[0]!.x,
    source.actions[0]!.y,
  ]);
}

function keysTyped(sent: Sent) {
  return performed(sent, "key")
    .flatMap((source) => source.actions.map((action) => action.value))
    .join("");
}

test("click() retries through every check, then clicks the latest box centre once", async () => {
  const { locator, sent, calls, expressions } = locatorWith(
    "button",
    detached, // attached ✗
    state({ visible: false }), // visible ✗
    state({ box: { ...BOX, x: 0 } }), // stable ✗ (moved)
    state(), // stable ✗ (moved back)
    state({ enabled: false }), // enabled ✗
    state({ hitTarget: "div#overlay" }), // hit target ✗
    state(), // actionable
  );
  assert.equal(await locator.click({ timeout: 3000 }), undefined);
  assert.equal(expressions.length, 7);
  assert.deepEqual(calls[0]!.args[1], { scroll: true, hitTest: true });
  assert.deepEqual(pointerClicks(sent), [[60, 40]]);
});

test("click() needs the same box on two probes, so a ready element is probed twice", async () => {
  const { locator, expressions } = locatorWith("button", state());
  await locator.click({ timeout: 3000 });
  assert.equal(expressions.length, 2);
});

test("click() timeout lists the checks of the last probe", async () => {
  const { locator, sent } = locatorWith("button", state({ enabled: false }));
  await assert.rejects(locator.click({ timeout: 250 }), (err) => {
    assert.ok(err instanceof ActionTimeoutError);
    assert.equal(err.reason, "not-actionable");
    assert.equal(
      err.message,
      "click(): //button was not actionable within 250ms\n" +
        "  attached ✓  visible ✓  stable ✓  enabled ✗  hit target —",
    );
    return true;
  });
  assert.deepEqual(pointerClicks(sent), []);
});

test("click() timeout names a covering element", async () => {
  const { locator } = locatorWith(
    "button",
    state({ hitTarget: "div#cookie-banner.overlay" }),
  );
  await assert.rejects(
    locator.click({ timeout: 250 }),
    new ActionTimeoutError({
      action: "click",
      selector: "//button",
      timeout: 250,
      reason: "not-actionable",
      checks: {
        attached: "pass",
        visible: "pass",
        stable: "pass",
        enabled: "pass",
        "hit target": "fail",
      },
      coveredBy: "div#cookie-banner.overlay",
    }),
  );
});

test("click() with timeout 0 probes once and skips the stability check", async () => {
  const { locator, sent, expressions } = locatorWith("button", state());
  assert.equal(await locator.click({ timeout: 0 }), undefined);
  assert.equal(expressions.length, 1);
  assert.deepEqual(pointerClicks(sent), [[60, 40]]);
});

test("click() with timeout 0 on a disabled element reports no stable entry", async () => {
  const { locator, sent } = locatorWith("button", state({ enabled: false }));
  await assert.rejects(locator.click({ timeout: 0 }), (err) => {
    assert.ok(err instanceof ActionTimeoutError);
    assert.equal(
      err.message,
      "click(): //button was not actionable within 0ms\n" +
        "  attached ✓  visible ✓  enabled ✗  hit target —",
    );
    return true;
  });
  assert.deepEqual(pointerClicks(sent), []);
});

test("click() timeout on a hidden element does not report a covering element", async () => {
  const { locator } = locatorWith(
    "button",
    state({ visible: false, hitTarget: "html" }),
  );
  await assert.rejects(locator.click({ timeout: 250 }), (err) => {
    assert.ok(err instanceof ActionTimeoutError);
    assert.equal(err.coveredBy, undefined);
    return true;
  });
});

test("click() on an element that never appears reports it was not attached", async () => {
  const { locator } = locatorWith("button", detached);
  await assert.rejects(
    locator.click({ timeout: 250 }),
    /^ActionTimeoutError: click\(\): \/\/button was not attached within 250ms$/,
  );
});

test("click() when no probe completes reports it could not read the element", async () => {
  const { locator } = locatorWith("button", { hang: true });
  await assert.rejects(locator.click({ timeout: 250 }), (err) => {
    assert.ok(err instanceof ActionTimeoutError);
    assert.equal(err.reason, "unreadable");
    assert.equal(err.message, "click(): could not read //button within 250ms");
    return true;
  });
});

test("force skips every check except attached", async () => {
  const { locator, sent, expressions } = locatorWith(
    "button",
    state({ visible: false, enabled: false, hitTarget: "div#overlay" }),
  );
  await locator.click({ force: true, timeout: 1000 });
  assert.equal(expressions.length, 1);
  assert.ok(expressions[0]!.includes("scrollIntoView"));
  assert.deepEqual(pointerClicks(sent), [[60, 40]]);
});

test("force still waits for the element to be attached", async () => {
  const { locator } = locatorWith("button", detached);
  await assert.rejects(
    locator.click({ force: true, timeout: 250 }),
    /was not attached within 250ms/,
  );
});

test("fill() waits until the field is editable, then clicks, selects and types", async () => {
  const { locator, sent, expressions } = locatorWith(
    "input",
    state({ editable: false }),
    state(),
    { type: "undefined" },
  );
  await locator.fill("ab", { timeout: 3000 });
  assert.equal(expressions.length, 3);
  assert.match(expressions[2]!, /\.select\(\)/);
  assert.deepEqual(pointerClicks(sent), [[60, 40]]);
  assert.equal(keysTyped(sent), "aabb");
});

test("press() waits until the element is usable, focuses it and presses the key", async () => {
  const { locator, expressions, sent } = locatorWith(
    "input",
    state({ enabled: false }),
    state(),
    { type: "undefined" },
  );
  await locator.press("Enter", { timeout: 3000 });
  assert.match(expressions[2]!, /\.focus\(\)/);
  assert.equal(keysTyped(sent), "\uE007\uE007", "key down and key up of Enter");
  assert.deepEqual(pointerClicks(sent), [], "no click");
});

test("press() sends a single character as it is and names the special keys", async () => {
  const { locator, sent } = locatorWith(
    "input",
    state(),
    { type: "undefined" },
    state(),
    { type: "undefined" },
  );
  await locator.press("Escape");
  await locator.press("a");
  assert.equal(keysTyped(sent), "\uE00C\uE00Caa");
});

test("press() holds the modifiers around the key", async () => {
  const { locator, sent } = locatorWith("textarea", state(), {
    type: "undefined",
  });
  await locator.press("Control+Enter");
  const [source] = performed(sent, "key");
  assert.deepEqual(
    source!.actions.map((action) => `${action.type}:${action.value}`),
    ["keyDown:\uE009", "keyDown:\uE007", "keyUp:\uE007", "keyUp:\uE009"],
  );
});

test("press() rejects a key it does not know before touching the page", async () => {
  const { locator, sent } = locatorWith("input", state());
  await assert.rejects(locator.press("Hyper"), /unknown key "Hyper"/);
  assert.equal(sent.length, 0);
});

test("fill() timeout lists the fill checks", async () => {
  const { locator } = locatorWith("input", state({ editable: false }));
  await assert.rejects(
    locator.fill("x", { timeout: 250 }),
    (err) =>
      err instanceof ActionTimeoutError &&
      err.message ===
        "fill(): //input was not actionable within 250ms\n" +
          "  attached ✓  visible ✓  enabled ✓  editable ✗  hit target —",
  );
});

test("focus() waits only for the element to be attached", async () => {
  const { locator, expressions, calls } = locatorWith(
    "input",
    detached,
    state({ visible: false, enabled: false }),
    { type: "undefined" },
  );
  assert.equal(await locator.focus({ timeout: 3000 }), undefined);
  assert.equal(expressions.length, 3);
  assert.deepEqual(calls[0]!.args[1], { scroll: false, hitTest: false });
  assert.match(expressions[2]!, /el\.focus\(\)/);
});

test("isEnabled() and isEditable() read the state without waiting", async () => {
  assert.equal(await locatorWith("button", state()).locator.isEnabled(), true);
  assert.equal(
    await locatorWith("button", state({ enabled: false })).locator.isEnabled(),
    false,
  );
  assert.equal(
    await locatorWith("button", detached).locator.isEnabled(),
    false,
  );
  assert.equal(await locatorWith("input", state()).locator.isEditable(), true);
  assert.equal(
    await locatorWith("input", state({ editable: false })).locator.isEditable(),
    false,
  );
  assert.equal(
    await locatorWith("input", detached).locator.isEditable(),
    false,
  );
});

test("waitFor() waits for visible by default, without scrolling", async () => {
  const { locator, expressions, calls } = locatorWith(
    "div",
    state({ visible: false }),
    state(),
  );
  await locator.waitFor({ timeout: 3000 });
  assert.equal(expressions.length, 2);
  assert.deepEqual(calls[0]!.args[1], { scroll: false, hitTest: false });
});

test('waitFor({ state: "hidden" }) resolves once the element is gone or invisible', async () => {
  const gone = locatorWith("div", state(), detached);
  await gone.locator.waitFor({ state: "hidden", timeout: 3000 });
  assert.equal(gone.expressions.length, 2);

  const invisible = locatorWith("div", state(), state({ visible: false }));
  await invisible.locator.waitFor({ state: "hidden", timeout: 3000 });
  assert.equal(invisible.expressions.length, 2);
});

test("waitFor() for attached and detached", async () => {
  const appears = locatorWith("div", detached, state({ visible: false }));
  await appears.locator.waitFor({ state: "attached", timeout: 3000 });
  assert.equal(appears.expressions.length, 2);

  const disappears = locatorWith("div", state(), detached);
  await disappears.locator.waitFor({ state: "detached", timeout: 3000 });
  assert.equal(disappears.expressions.length, 2);
});

test("waitFor() timeout names the state it waited for", async () => {
  const { locator } = locatorWith("div", state({ visible: false }));
  await assert.rejects(locator.waitFor({ timeout: 250 }), (err) => {
    assert.ok(err instanceof ActionTimeoutError);
    assert.equal(err.reason, "wrong-state");
    assert.equal(err.state, "visible");
    assert.equal(
      err.message,
      "waitFor(): //div did not become visible within 250ms",
    );
    return true;
  });
});

test("waitFor() when no probe completes reports it could not read the element", async () => {
  const { locator } = locatorWith("div", { hang: true });
  await assert.rejects(
    locator.waitFor({ state: "hidden", timeout: 250 }),
    /^ActionTimeoutError: waitFor\(\): could not read \/\/div within 250ms$/,
  );
});

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
    locator: new Locator(xpath, stub.connector, "ctx", helpers),
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
  const items = await new Locator("li", stub.connector, "ctx", helpers).all();
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
