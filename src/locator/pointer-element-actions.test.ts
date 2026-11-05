import { test } from "node:test";
import assert from "node:assert/strict";
import Locator from "./locator.js";
import { cssSelector, xpathSelector } from "./selector.js";
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
    editable: true,
    box: BOX,
    hitTarget: "self",
    ...overrides,
  });
}

function locatorWith(...responses: StubResponse[]) {
  const stub = stubConnector(...responses);
  return {
    locator: new Locator([xpathSelector("//button")], stub.connector, "ctx"),
    ...stub,
  };
}

type Source = {
  type: string;
  id: string;
  parameters?: { pointerType: string };
  actions: Array<Record<string, unknown>>;
};
type Sent = Array<{ method: string; params: unknown }>;

/** Every input source sent, in order, each with the type of its actions flattened to a short word list */
function sources(sent: Sent): Source[] {
  return sent
    .filter(({ method }) => method === "input.performActions")
    .map(({ params }) => (params as { actions: Source[] }).actions[0]!);
}

const words = (source: Source) =>
  source.actions.map((action) =>
    action.type === "pointerMove"
      ? `move(${action.x},${action.y})`
      : action.type === "pointerDown" || action.type === "pointerUp"
        ? `${action.type}:${action.button}`
        : action.type === "pause"
          ? `pause:${action.duration}`
          : `${action.type}:${action.value}`,
  );

test("click() with a position clicks that far from the top left corner and hit-tests there", async () => {
  const { locator, sent, calls } = locatorWith(state());
  await locator.click({ position: { x: 5, y: 7 }, timeout: 3000 });
  assert.deepEqual(words(sources(sent)[0]!), [
    "move(15,27)",
    "pointerDown:0",
    "pointerUp:0",
  ]);
  assert.deepEqual(calls[0]!.args[1], {
    scroll: true,
    hitTest: true,
    at: { x: 5, y: 7 },
  });
});

test("click() takes a button, a click count and a delay between press and release", async () => {
  const { locator, sent } = locatorWith(state());
  await locator.click({ button: "right", clickCount: 2, delay: 40 });
  assert.deepEqual(words(sources(sent)[0]!), [
    "move(60,40)",
    "pointerDown:2",
    "pause:40",
    "pointerUp:2",
    "pointerDown:2",
    "pause:40",
    "pointerUp:2",
  ]);
});

test("click() holds the modifiers around the click and lets go in reverse order", async () => {
  const { locator, sent } = locatorWith(state());
  await locator.click({ modifiers: ["Control", "Shift"] });
  const all = sources(sent);
  assert.deepEqual(words(all[0]!), ["keyDown:", "keyDown:"]);
  assert.equal(all[1]!.type, "pointer");
  assert.deepEqual(words(all[2]!), ["keyUp:", "keyUp:"]);
});

test("click() lets go of the modifiers when the click fails", async () => {
  const { locator, sent } = locatorWith(state());
  const original = sent.push.bind(sent);
  sent.push = (...items) => {
    if (
      items.some(
        (item) =>
          item.method === "input.performActions" &&
          (item.params as { actions: Source[] }).actions[0]!.type === "pointer",
      )
    ) {
      original(...items);
      throw new Error("boom");
    }
    return original(...items);
  };
  await assert.rejects(locator.click({ modifiers: ["Alt"] }), /boom/);
  assert.deepEqual(words(sources(sent).slice(-1)[0]!), ["keyUp:"]);
});

test("click() rejects what it cannot send before touching the page", async () => {
  const { locator, sent } = locatorWith(state());
  await assert.rejects(
    locator.click({ button: "back" as never }),
    /click\(\): unknown button "back"/,
  );
  await assert.rejects(
    locator.click({ clickCount: 0 }),
    /click\(\): clickCount must be a whole number/,
  );
  await assert.rejects(
    locator.click({ position: { x: NaN, y: 1 } }),
    /click\(\): position must be \{ x, y \} in pixels/,
  );
  await assert.rejects(
    locator.click({ modifiers: ["Hyper" as never] }),
    /click\(\): unknown modifier "Hyper"/,
  );
  assert.equal(sent.length, 0);
});

test("dblclick() is a click with two presses and names itself in errors", async () => {
  const { locator, sent } = locatorWith(state());
  await locator.dblclick();
  assert.deepEqual(words(sources(sent)[0]!), [
    "move(60,40)",
    "pointerDown:0",
    "pointerUp:0",
    "pointerDown:0",
    "pointerUp:0",
  ]);
  await assert.rejects(
    locator.dblclick({ button: "back" as never }),
    /dblclick\(\): unknown button/,
  );
});

test("hover() only moves the mouse, and does not need an enabled element", async () => {
  const { locator, sent } = locatorWith(state({ enabled: false }));
  await locator.hover({ timeout: 3000 });
  assert.deepEqual(words(sources(sent)[0]!), ["move(60,40)"]);
});

test("hover() waits for the element to be uncovered", async () => {
  const { locator } = locatorWith(state({ hitTarget: "div#cover" }));
  await assert.rejects(
    locator.hover({ timeout: 250 }),
    /hover\(\): \/\/button was not actionable within 250ms\n {2}attached ✓ {2}visible ✓ {2}stable ✓ {2}hit target ✗/,
  );
});

test("tap() uses a touch pointer of its own", async () => {
  const { locator, sent } = locatorWith(state());
  await locator.tap();
  const [source] = sources(sent);
  assert.equal(source!.parameters?.pointerType, "touch");
  assert.notEqual(source!.id, "samurai-pointer");
  assert.deepEqual(words(source!), [
    "move(60,40)",
    "pointerDown:0",
    "pointerUp:0",
  ]);
});

test("a strict locator makes hover, tap and dblclick throw when several elements match", async () => {
  const stub = stubConnector(state());
  stub.nodeCounts(2);
  const locator = new Locator(
    [cssSelector("li")],
    stub.connector,
    "ctx",
  ).strict();
  await assert.rejects(
    locator.hover({ timeout: 0 }),
    /hover\(\): strict mode violation, 2 elements match css=li/,
  );
  await assert.rejects(locator.tap({ timeout: 0 }), /tap\(\): strict mode/);
  await assert.rejects(
    locator.dblclick({ timeout: 0 }),
    /dblclick\(\): strict mode/,
  );
});

test("press() sends a chord: modifiers down, the key, modifiers up in reverse", async () => {
  const { locator, sent } = locatorWith(state(), { type: "undefined" });
  await locator.press("Control+Shift+Tab");
  assert.deepEqual(words(sources(sent)[0]!), [
    "keyDown:",
    "keyDown:",
    "keyDown:",
    "keyUp:",
    "keyUp:",
    "keyUp:",
  ]);
});

test("press() with a delay pauses between the key down and up", async () => {
  const { locator, sent } = locatorWith(state(), { type: "undefined" });
  await locator.press("a", { delay: 25 });
  assert.deepEqual(words(sources(sent)[0]!), [
    "keyDown:a",
    "pause:25",
    "keyUp:a",
  ]);
});

test("pressSequentially() focuses the element, then presses each character with the delay between them", async () => {
  const { locator, sent, expressions } = locatorWith(state(), {
    type: "undefined",
  });
  await locator.pressSequentially("ab\n", { delay: 10 });
  assert.ok(expressions.some((e) => /\.focus\(\)/.test(e)));
  assert.deepEqual(words(sources(sent)[0]!), [
    "keyDown:a",
    "keyUp:a",
    "pause:10",
    "keyDown:b",
    "keyUp:b",
    "pause:10",
    "keyDown:",
    "keyUp:",
  ]);
});

test("blur() waits for the element and calls blur on it", async () => {
  const { locator, expressions } = locatorWith(state({ visible: false }), {
    type: "undefined",
  });
  await locator.blur();
  assert.match(expressions[expressions.length - 1]!, /el\.blur\(\)/);
});

test("clear() fills with an empty string: select, then Backspace", async () => {
  const { locator, sent } = locatorWith(state(), { type: "undefined" });
  await locator.clear();
  const keys = sources(sent).filter((source) => source.type === "key");
  assert.deepEqual(words(keys[0]!), ["keyDown:", "keyUp:"]);
});

test("dispatchEvent() does not check visibility, and sends the type, the init and the class table", async () => {
  const { locator, calls } = locatorWith(state({ visible: false }), {
    type: "undefined",
  });
  await locator.dispatchEvent("keydown", { key: "x" });
  const call = calls[calls.length - 1]!;
  assert.match(
    call.functionDeclaration,
    /dispatchEvent\(new Ctor\(type, init\)\)/,
  );
  assert.equal(call.args[1], "keydown");
  assert.deepEqual(call.args[2], { key: "x" });
  assert.ok(
    (call.args[3] as { KeyboardEvent: string[] }).KeyboardEvent.includes(
      "keydown",
    ),
  );
});

test("dispatchEvent() rejects an empty type", async () => {
  const { locator, sent } = locatorWith(state());
  await assert.rejects(
    locator.dispatchEvent(""),
    /dispatchEvent\(\): type must not be empty/,
  );
  assert.equal(sent.length, 0);
});
