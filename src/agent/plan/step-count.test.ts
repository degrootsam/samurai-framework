import { test } from "node:test";
import assert from "node:assert/strict";
import { planStepCount } from "./step-count.js";

test("counts the steps of a plan, and is 0 for anything unreadable", () => {
  assert.equal(planStepCount("## Steps\n\n1. One\n2. Two\n\n## Seen\n"), 2);
  assert.equal(planStepCount("no steps heading"), 0);
  assert.equal(planStepCount("## Steps\n\n- None.\n"), 0);
  assert.equal(planStepCount(undefined), 0);
});
