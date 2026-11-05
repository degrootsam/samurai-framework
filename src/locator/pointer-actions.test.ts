import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonCode, moveSteps, pointInRect } from "./pointer-actions.js";

test("the point of a rect is its centre, or an offset from its top left corner", () => {
  const rect = { x: 10, y: 20, width: 100, height: 40 };
  assert.deepEqual(pointInRect(rect), { x: 60, y: 40 });
  assert.deepEqual(pointInRect(rect, { x: 1, y: 2 }), { x: 11, y: 22 });
});

test("moves run in a straight line and end on the target", () => {
  assert.deepEqual(moveSteps({ x: 0, y: 0 }, { x: 10, y: 20 }, 2), [
    { type: "pointerMove", x: 5, y: 10 },
    { type: "pointerMove", x: 10, y: 20 },
  ]);
  assert.equal(moveSteps({ x: 0, y: 0 }, { x: 1, y: 1 }, 0).length, 1);
});

test("buttons map to BiDi numbers, and an unknown one names the method", () => {
  assert.deepEqual(
    (["left", "middle", "right"] as const).map((b) => buttonCode(b, "click")),
    [0, 1, 2],
  );
  assert.throws(
    () => buttonCode("back" as never, "mouse.click"),
    /mouse\.click\(\): unknown button "back"/,
  );
});
