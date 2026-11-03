import { test } from "node:test";
import assert from "node:assert/strict";
import Locator from "./locator.js";
import { xpathSelector } from "./selector.js";
import { ActionTimeoutError } from "./action-timeout-error.js";
import type { ElementState } from "./element-state.js";
import {
  remote,
  stubConnector,
  type StubResponse,
} from "../testing/stub-connector.js";

const BOX = { x: 10, y: 20, width: 100, height: 40 };

function state(overrides: Partial<ElementState> = {}): StubResponse {
  return remote({
    attached: true,
    visible: true,
    enabled: true,
    editable: false,
    box: BOX,
    hitTarget: "self",
    ...overrides,
  });
}

/** What the page answers to "what is this control, and is it checked" */
function control(
  kind: "checkbox" | "radio" | null,
  checked: boolean,
): StubResponse {
  return remote({ kind, checked });
}

function locatorWith(...responses: StubResponse[]) {
  const stub = stubConnector(...responses);
  return {
    locator: new Locator([xpathSelector("input")], stub.connector, "ctx"),
    ...stub,
  };
}

type Performed = {
  actions: Array<{ actions: Array<{ type: string; x?: number; y?: number }> }>;
};

function pointerClicks(sent: Array<{ method: string; params: unknown }>) {
  return sent
    .filter(({ method }) => method === "input.performActions")
    .map(({ params }) => (params as Performed).actions[0]!.actions[0]!)
    .map((move) => [move.x, move.y]);
}

test("check() clicks the centre of the box the probe chose, then verifies the state", async () => {
  const { locator, sent, calls } = locatorWith(
    state(), // attached
    control("checkbox", false),
    state(), // actionable (stable needs two probes)
    state(),
    control("checkbox", true), // after the click
  );
  assert.equal(await locator.check({ timeout: 3000 }), undefined);
  assert.deepEqual(pointerClicks(sent), [[60, 40]]);
  assert.deepEqual(calls[2]!.args[1], {
    scroll: true,
    hitTest: true,
    control: true,
  });
});

test("check() clicks where the probe says, which is a label's box for a hidden input", async () => {
  const label = { x: 0, y: 0, width: 20, height: 20 };
  const { locator, sent } = locatorWith(
    state(),
    control("checkbox", false),
    state({ box: label }),
    state({ box: label }),
    control("checkbox", true),
  );
  await locator.check({ timeout: 3000 });
  assert.deepEqual(pointerClicks(sent), [[10, 10]]);
});

test("check() on a checked control clicks nothing and does not wait for actionability", async () => {
  const { locator, sent, expressions } = locatorWith(
    state({ enabled: false }),
    control("checkbox", true),
  );
  await locator.check({ timeout: 3000 });
  assert.deepEqual(pointerClicks(sent), []);
  assert.equal(expressions.length, 2);
});

test("uncheck() and setChecked(false) click a checked checkbox", async () => {
  for (const run of [
    (l: Locator) => l.uncheck({ timeout: 3000 }),
    (l: Locator) => l.setChecked(false, { timeout: 3000 }),
  ]) {
    const { locator, sent } = locatorWith(
      state(),
      control("checkbox", true),
      state(),
      state(),
      control("checkbox", false),
    );
    await run(locator);
    assert.equal(pointerClicks(sent).length, 1);
  }
});

test("setChecked(true) on a checked control does nothing", async () => {
  const { locator, sent } = locatorWith(state(), control("checkbox", true));
  await locator.setChecked(true);
  assert.deepEqual(pointerClicks(sent), []);
});

test("check() throws when the click did not change the state", async () => {
  const { locator } = locatorWith(
    state(),
    control("checkbox", false),
    state(),
    state(),
    control("checkbox", false),
  );
  await assert.rejects(
    locator.check({ timeout: 3000 }),
    /^Error: check\(\): clicking the checkbox did not change its state$/,
  );
});

test("uncheck() on a checked radio throws before clicking", async () => {
  const { locator, sent } = locatorWith(state(), control("radio", true));
  await assert.rejects(
    locator.uncheck({ timeout: 3000 }),
    /^Error: uncheck\(\): a radio button cannot be unchecked$/,
  );
  assert.deepEqual(pointerClicks(sent), []);
});

test("check() throws for an element that is not checkable", async () => {
  const { locator, sent } = locatorWith(state(), control(null, false));
  await assert.rejects(
    locator.check({ timeout: 3000 }),
    /^Error: check\(\): element is not a checkbox, radio, or role=checkbox\/radio\/switch$/,
  );
  assert.deepEqual(pointerClicks(sent), []);
});

test("check() with trial waits for actionability but does not click", async () => {
  const { locator, sent, expressions } = locatorWith(
    state(),
    control("checkbox", false),
    state(),
  );
  await locator.check({ trial: true, timeout: 3000 });
  assert.deepEqual(pointerClicks(sent), []);
  assert.equal(expressions.length, 4);
});

test("check() with force skips the actionability checks", async () => {
  const { locator, sent } = locatorWith(
    state({ enabled: false, hitTarget: "div#overlay" }),
    control("checkbox", false),
    state({ enabled: false, hitTarget: "div#overlay" }),
    control("checkbox", true),
  );
  await locator.check({ force: true, timeout: 3000 });
  assert.equal(pointerClicks(sent).length, 1);
});

test("check() on a disabled control times out like click() does, naming the check", async () => {
  const { locator, sent } = locatorWith(
    state({ enabled: false }),
    control("checkbox", false),
    state({ enabled: false }),
  );
  await assert.rejects(locator.check({ timeout: 250 }), (err) => {
    assert.ok(err instanceof ActionTimeoutError);
    assert.match(err.message, /^check\(\): \/\/input was not actionable/);
    assert.match(err.message, /enabled ✗/);
    return true;
  });
  assert.deepEqual(pointerClicks(sent), []);
});

test("isDisabled() and isHidden() are the opposites of isEnabled() and isVisible()", async () => {
  const hidden = locatorWith(state({ visible: false, enabled: false })).locator;
  assert.equal(await hidden.isHidden(), true);
  assert.equal(await hidden.isDisabled(), true);
  const shown = locatorWith(state()).locator;
  assert.equal(await shown.isHidden(), false);
  assert.equal(await shown.isDisabled(), false);
  const missing = locatorWith(
    state({ attached: false, visible: false, enabled: false, box: null }),
  ).locator;
  assert.equal(await missing.isHidden(), true);
});
