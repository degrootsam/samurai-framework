import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPlan, parsePlan } from "./plan-file.js";
import { readPlan } from "./read-plan.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "plan-front-"));
let n = 0;
const fresh = () => path.join(dir, `plan-${n++}.md`);
const FRONT = "---\nstatus: ready\ntests: [a.spec.ts > A]\nunknown: {x}\n---\n";

test("parsePlan ignores a leading front matter block", () => {
  const plan = parsePlan(
    `${FRONT}\n# Plan: T\n\nGoal: g\n\n## Steps\n\n1. Open.\n`,
  );
  assert.equal(plan.title, "T");
  assert.equal(plan.goal, "g");
  assert.deepEqual(plan.steps, [{ text: "Open." }]);
});

test("parsePlan names an unclosed front matter block", () => {
  assert.throws(
    () => parsePlan("---\nstatus: ready\n\n## Steps\n1. a\n"),
    /parsePlan\(\): .*no closing "---"/,
  );
});

test("rewriting a plan keeps the front matter of the file, including edits made meanwhile", () => {
  const out = fresh();
  writeFileSync(out, `${FRONT}\n# Plan: old\n\n## Steps\n`);
  const plan = createPlan({ goal: "g", start: "", out, force: true });
  assert.ok(readFileSync(out, "utf8").startsWith(`${FRONT}# Plan: g\n`));
  writeFileSync(
    out,
    readFileSync(out, "utf8").replace("status: ready", "status: draft"),
  );
  plan.addStep("Open.");
  const text = readFileSync(out, "utf8");
  assert.ok(text.startsWith("---\nstatus: draft\n"));
  assert.equal(parsePlan(text).steps.length, 1);
});

test("readPlan leaves the front matter out of the text", () => {
  const body = "\n# Plan: x\n\n## Steps\n\n1. Open.\n";
  const file = fresh();
  writeFileSync(file, `---\nstatus: ready\nwhatever: 1\n---\n${body}`);
  assert.equal(readPlan(file), body);
});

test("readPlan names the file for an unclosed front matter block", () => {
  const file = fresh();
  writeFileSync(file, "---\nstatus: ready\n\n## Steps\n1. a\n");
  assert.throws(
    () => readPlan(file),
    /readPlan\(\): .*plan-\d+\.md: .*no closing "---"/,
  );
});
