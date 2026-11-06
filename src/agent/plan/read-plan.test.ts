import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_PLAN_BYTES } from "./plan-file.js";
import { readPlan } from "./read-plan.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "read-plan-"));
const write = (name: string, text: string) => {
  const file = path.join(dir, name);
  writeFileSync(file, text);
  return file;
};

test("a plan is returned as written", () => {
  const text = "# Plan: x\n\n## Steps\n\n1. Open.\n";
  assert.equal(readPlan(write("ok.md", text)), text);
});

test("a hand-written plan with only Steps is fine", () => {
  const text = "## Steps\n1. Open it.\n";
  assert.equal(readPlan(write("min.md", text)), text);
});

test("a missing file is named", () => {
  const file = path.join(dir, "nope.md");
  assert.throws(
    () => readPlan(file),
    new RegExp(`readPlan\\(\\): .*nope\\.md cannot be read`),
  );
});

test("a file over 32 KB is refused with its size", () => {
  const file = write("big.md", `## Steps\n${"x".repeat(MAX_PLAN_BYTES)}`);
  assert.throws(() => readPlan(file), /big\.md is 33 KB, over the 32 KB limit/);
});

test("a file without a Steps heading says so", () => {
  const file = write("nosteps.md", "# Plan: x\n\nGoal: y\n");
  assert.throws(
    () => readPlan(file),
    /nosteps\.md: the plan has no "## Steps" heading/,
  );
});
