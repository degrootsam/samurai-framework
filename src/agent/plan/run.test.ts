import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scriptedModel } from "../../testing/scripted-model.js";
import { runPlan } from "../index.js";
import type { AgentEvent, PlanOptions } from "../types.js";

const options = (extra: Partial<PlanOptions> = {}): PlanOptions => ({
  model: scriptedModel([{ text: "hi" }]),
  goal: "x",
  out: "plans/a.md",
  projectDir: mkdtempSync(path.join(os.tmpdir(), "plan-run-")),
  config: {},
  ...extra,
});

test("a string model id is refused at the entry", () => {
  assert.throws(
    () => runPlan(options({ model: "anthropic/claude-sonnet-4" as never })),
    /model must be a model object/,
  );
});

test("an existing plan file is an error that names it, before a browser opens, and the file is kept", async () => {
  const opts = options();
  const file = path.join(opts.projectDir!, "plans", "a.md");
  mkdirSync(path.dirname(file));
  writeFileSync(file, "old");
  const seen: AgentEvent[] = [];
  const result = await runPlan({ ...opts, onEvent: (e) => seen.push(e) })
    .result;
  assert.equal(result.reason, "error");
  assert.match(result.error ?? "", /createPlan\(\): .*a\.md already exists/);
  assert.equal(result.file, "plans/a.md");
  assert.equal(result.steps, 0);
  assert.equal(readFileSync(file, "utf8"), "old");
  assert.deepEqual(
    seen.map((e) => e.type),
    ["ended"],
  );
});
