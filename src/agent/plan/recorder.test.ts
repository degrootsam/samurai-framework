import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPlan } from "./plan-file.js";
import { PlanRecorder } from "./recorder.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "plan-recorder-"));
let n = 0;
function setup() {
  const out = path.join(dir, `p-${n++}.md`);
  const seen: [number, string][] = [];
  const recorder = new PlanRecorder(
    createPlan({ goal: "Register", start: "", out }),
    (num, text) => seen.push([num, text]),
  );
  return { recorder, out, seen };
}

test("a step is refused until something was done on the page", () => {
  const { recorder } = setup();
  assert.throws(
    () => recorder.addStep("Click A."),
    /all 0 actions so far are already recorded as steps; act first/,
  );
  recorder.observe({ type: "goto", url: "/" });
  assert.equal(recorder.addStep("Open the page."), 1);
  assert.throws(
    () => recorder.addStep("Click A."),
    /all 1 actions so far are already recorded as steps/,
  );
});

test("several actions in a row can be recorded as several steps", () => {
  const { recorder } = setup();
  for (let i = 0; i < 5; i++) recorder.observe({ type: "goto", url: `/${i}` });
  for (let i = 1; i <= 5; i++) assert.equal(recorder.addStep(`Step ${i}.`), i);
  assert.throws(
    () => recorder.addStep("Step 6."),
    /all 5 actions so far are already recorded as steps; act first/,
  );
  assert.equal(recorder.count, 5);
});

test("steps never exceed the actions done, in any order", () => {
  const { recorder } = setup();
  recorder.observe({ type: "goto", url: "/" });
  recorder.observe({ type: "goto", url: "/a" });
  recorder.addStep("One.");
  recorder.addStep("Two.");
  assert.throws(() => recorder.addStep("Three."), /act first/);
  recorder.observe({ type: "goto", url: "/b" });
  recorder.addStep("Three.");
  assert.equal(recorder.count, 3);
});

test("a step is announced and counted, and the file holds it", () => {
  const { recorder, out, seen } = setup();
  recorder.observe({ type: "goto", url: "/" });
  recorder.addStep("Open the page.", "the heading shows");
  assert.deepEqual(seen, [[1, "Open the page."]]);
  assert.equal(recorder.count, 1);
  assert.equal(recorder.testName, "Register");
  assert.match(readFileSync(out, "utf8"), /1\. Open the page\.\n {3}Expect/);
});

test("observe writes no events and undo removes nothing", () => {
  const { recorder } = setup();
  assert.deepEqual(recorder.observe({ type: "goto", url: "/" }), []);
  assert.equal(recorder.undo(3), 0);
});

test("blocked requests are kept until they are taken, once", () => {
  const { recorder } = setup();
  recorder.block("POST /submit");
  recorder.block("POST /submit");
  recorder.block("PUT /item");
  assert.deepEqual(recorder.takeBlocked(), ["POST /submit", "PUT /item"]);
  assert.deepEqual(recorder.takeBlocked(), []);
});
