import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allPass,
  elementStateScript,
  evaluateChecks,
  parseElementState,
  type CheckName,
  type ElementState,
} from "./element-state.js";

const EL = `document.evaluate("//button", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
const READY: ElementState = {
  attached: true,
  visible: true,
  enabled: true,
  editable: true,
  box: { x: 10, y: 20, width: 100, height: 40 },
  hitTarget: "self",
};
const ALL: CheckName[] = ["attached", "visible", "stable", "enabled", "editable", "hit target"];

test("the script compiles for every option combination", () => {
  for (const scroll of [false, true]) {
    for (const hitTest of [false, true]) {
      const script = elementStateScript(EL, { scroll, hitTest });
      assert.doesNotThrow(() => new Function(script), script);
    }
  }
});

test("the script embeds the element expression", () => {
  assert.ok(elementStateScript(EL, { scroll: false, hitTest: false }).includes(EL));
});

test("scrolling and hit testing are only included when requested", () => {
  const plain = elementStateScript(EL, { scroll: false, hitTest: false });
  assert.ok(!plain.includes("scrollIntoView"));
  assert.ok(!plain.includes("elementFromPoint"));
  const full = elementStateScript(EL, { scroll: true, hitTest: true });
  assert.ok(full.includes("scrollIntoView"));
  assert.ok(full.includes("elementFromPoint"));
});

test("parseElementState reads the JSON state", () => {
  assert.deepEqual(parseElementState({ type: "string", value: JSON.stringify(READY) }), READY);
});

test("parseElementState rejects a non-string result", () => {
  assert.throws(
    () => parseElementState({ type: "null" }),
    /Expected an element state string but received "null"/,
  );
});

test("parseElementState rejects malformed state", () => {
  assert.throws(
    () => parseElementState({ type: "string", value: "not json" }),
    /Malformed element state/,
  );
  assert.throws(
    () => parseElementState({ type: "string", value: JSON.stringify({ attached: true }) }),
    /Malformed element state/,
  );
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

test("editable is a boolean even for non-HTML elements without isContentEditable", () => {
  const script = elementStateScript(EL, { scroll: true, hitTest: true });
  const svg = {
    tagName: "svg",
    id: "",
    classList: [],
    matches: () => false,
    getAttribute: () => null,
    contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }),
  };
  const fakeDocument = {
    evaluate: () => ({ singleNodeValue: svg }),
    elementFromPoint: () => svg,
  };
  const fakeWindow = { innerWidth: 1000, innerHeight: 800 };
  const fakeComputeStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });

  const result = new Function(
    "document",
    "XPathResult",
    "getComputedStyle",
    "window",
    `return ${script}`,
  )(fakeDocument, { FIRST_ORDERED_NODE_TYPE: 9 }, fakeComputeStyle, fakeWindow) as string;

  const state = parseElementState({ type: "string", value: result });
  assert.equal(state.attached, true);
  assert.equal(state.editable, false);
  assert.equal(typeof state.editable, "boolean");
});
