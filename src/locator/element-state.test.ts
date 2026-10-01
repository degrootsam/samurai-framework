import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allPass,
  evaluateChecks,
  parseElementState,
  PROBE_ELEMENT,
  type CheckName,
  type ElementState,
} from "./element-state.js";

const READY: ElementState = {
  attached: true,
  visible: true,
  enabled: true,
  editable: true,
  box: { x: 10, y: 20, width: 100, height: 40 },
  hitTarget: "self",
};
const ALL: CheckName[] = ["attached", "visible", "stable", "enabled", "editable", "hit target"];

test("the probe is a function declaration that compiles", () => {
  assert.doesNotThrow(() => new Function(`return (${PROBE_ELEMENT})`), PROBE_ELEMENT);
});

test("the probe takes the located element and the options", () => {
  assert.match(PROBE_ELEMENT, /^\(el, options\) =>/);
  assert.ok(!PROBE_ELEMENT.includes("document.evaluate"), "the element is found by the browser's locate command");
});

test("scrolling and hit testing are switched by the options argument", () => {
  assert.match(PROBE_ELEMENT, /if \(options\.scroll\)/);
  assert.match(PROBE_ELEMENT, /if \(options\.hitTest\)/);
});

test("parseElementState accepts a complete state", () => {
  assert.deepEqual(parseElementState({ ...READY }), READY);
});

test("parseElementState rejects a non-object result", () => {
  assert.throws(
    () => parseElementState(null),
    /Expected an element state object but received "null"/,
  );
  assert.throws(
    () => parseElementState("string"),
    /Expected an element state object but received "string"/,
  );
});

test("parseElementState rejects malformed state", () => {
  assert.throws(() => parseElementState({ attached: true }), /Malformed element state/);
  assert.throws(
    () => parseElementState({ ...READY, visible: "yes" }),
    /Malformed element state/,
  );
  const { box: _box, ...withoutBox } = READY;
  assert.throws(() => parseElementState(withoutBox), /Malformed element state/);
});

test("evaluateChecks passes an actionable element whose box did not move", () => {
  const results = evaluateChecks(ALL, READY, READY);
  assert.deepEqual(results, {
    attached: "pass",
    visible: "pass",
    stable: "pass",
    enabled: "pass",
    editable: "pass",
    "hit target": "pass",
  });
  assert.equal(allPass(results), true);
});

test("the first failing check marks later checks pending", () => {
  const results = evaluateChecks(ALL, { ...READY, visible: false }, READY);
  assert.deepEqual(results, {
    attached: "pass",
    visible: "fail",
    stable: "pending",
    enabled: "pending",
    editable: "pending",
    "hit target": "pending",
  });
  assert.equal(allPass(results), false);
});

test("stable needs a previous probe with the same box", () => {
  const stable = (previous: ElementState | undefined) =>
    evaluateChecks(["stable"], READY, previous).stable;
  assert.equal(stable(undefined), "fail");
  assert.equal(stable({ ...READY, box: { ...READY.box!, x: 11 } }), "fail");
  assert.equal(stable({ ...READY, box: null }), "fail");
  assert.equal(stable(READY), "pass");
});

test("hit target passes only when the element itself is hit", () => {
  const hit = (hitTarget: string | null) =>
    evaluateChecks(["hit target"], { ...READY, hitTarget }, READY)["hit target"];
  assert.equal(hit("self"), "pass");
  assert.equal(hit("div#overlay"), "fail");
  assert.equal(hit(null), "fail");
});

test("only the required checks are evaluated, in the given order", () => {
  assert.deepEqual(Object.keys(evaluateChecks(["attached", "enabled"], READY, undefined)), [
    "attached",
    "enabled",
  ]);
});

/** Runs the probe against fake DOM objects, the way the page would call it */
function runProbe(element: object | null, options = { scroll: true, hitTest: true }) {
  const fakeDocument = {
    elementFromPoint: () => element,
  };
  const fakeWindow = { innerWidth: 1000, innerHeight: 800 };
  const fakeComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  const probe = new Function(
    "document",
    "XPathResult",
    "getComputedStyle",
    "window",
    `return (${PROBE_ELEMENT})`,
  )(fakeDocument, { FIRST_ORDERED_NODE_TYPE: 9 }, fakeComputedStyle, fakeWindow) as (
    el: object | null,
    options: { scroll: boolean; hitTest: boolean },
  ) => unknown;
  return parseElementState(probe(element, options));
}

test("editable is a boolean even for non-HTML elements without isContentEditable", () => {
  const svg = {
    isConnected: true,
    tagName: "svg",
    id: "",
    classList: [],
    matches: () => false,
    getAttribute: () => null,
    contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }),
  };
  const state = runProbe(svg);
  assert.equal(state.attached, true);
  assert.equal(state.editable, false);
  assert.equal(typeof state.editable, "boolean");
  assert.equal(state.hitTarget, "self");
});

test("the probe reports a missing element as not attached", () => {
  const state = runProbe(null);
  assert.equal(state.attached, false);
  assert.equal(state.box, null);
  assert.equal(state.hitTarget, null);
});

test("a node that was removed from the document is not attached, though the browser still resolves it", () => {
  const removed = {
    isConnected: false,
    getBoundingClientRect: () => {
      throw new Error("must not be measured");
    },
  };
  const state = runProbe(removed);
  assert.equal(state.attached, false);
  assert.equal(state.box, null);
});

test("the probe skips the hit test unless asked", () => {
  const el = {
    isConnected: true,
    tagName: "button",
    id: "",
    classList: [],
    matches: () => false,
    getAttribute: () => null,
    contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }),
  };
  assert.equal(runProbe(el, { scroll: false, hitTest: false }).hitTarget, null);
  assert.equal(runProbe(el, { scroll: false, hitTest: true }).hitTarget, "self");
});
