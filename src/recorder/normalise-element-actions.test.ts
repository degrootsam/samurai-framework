import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LocatorSpec } from "../steps/model.js";
import { Normaliser, type Observation } from "./normalise.js";

const loc = (testId: string): LocatorSpec => ({
  chain: [{ method: "getByTestId", testId }],
  fallbacks: [],
});

describe("Normaliser: an action on an element with no argument", () => {
  it("writes hover, dblclick and clear as their own steps", () => {
    const n = new Normaliser({ at: 2 });
    for (const [index, kind] of (
      ["hover", "dblclick", "clear"] as const
    ).entries())
      assert.deepEqual(
        n.observe({ type: "action", kind, locator: loc("a") }, index),
        [{ op: "insert", index: 2 + index, step: { kind, locator: loc("a") } }],
      );
  });

  it("ends the rewrite of a fill, so the next fill is a new step", () => {
    const n = new Normaliser({ at: 0 });
    const fill = (value: string): Observation => ({
      type: "input",
      key: "f",
      locator: loc("f"),
      value,
    });
    n.observe(fill("a"), 0);
    n.observe({ type: "action", kind: "clear", locator: loc("f") }, 1);
    assert.equal(n.observe(fill("b"), 2)[0]?.op, "insert");
  });
});
