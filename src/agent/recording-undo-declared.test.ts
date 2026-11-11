import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withProject } from "../runner/project.js";
import type { LocatorSpec } from "../steps/model.js";
import { StepRecorder } from "./recording.js";

async function inProject(work: (steps: StepRecorder, file: string) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-undo-"));
  await withProject({ projectDir: dir, config: {} }, async () => {
    const steps = new StepRecorder({ file: "a.spec.ts", create: "t" });
    work(steps, path.join(dir, "a.spec.ts"));
  });
}

const field: LocatorSpec = {
  chain: [{ method: "getByCss", css: "#name" }],
  fallbacks: [],
};
const goto = (steps: StepRecorder, url: string) =>
  steps.observe({ type: "goto", url });
const insertInput = (steps: StepRecorder, name: string, value: string) =>
  steps.observe({
    type: "insert",
    locator: field,
    value: { kind: "input", name },
    declare: value,
  });
const saveOutput = (steps: StepRecorder, name: string) =>
  steps.observe({ type: "saveOutput", locator: field, name });

test("undo takes out the input a removed step declared", async () => {
  await inProject((steps, file) => {
    goto(steps, "http://x.test/a");
    insertInput(steps, "name", "Ada");
    assert.match(readFileSync(file, "utf8"), /inputs: /);
    steps.undo(1);
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /inputs: /);
    assert.doesNotMatch(source, /Ada/);
  });
});

test("undo takes out the output a removed step saved", async () => {
  await inProject((steps, file) => {
    goto(steps, "http://x.test/a");
    saveOutput(steps, "title");
    assert.match(readFileSync(file, "utf8"), /outputs: /);
    steps.undo(1);
    assert.doesNotMatch(readFileSync(file, "utf8"), /outputs: |title/);
  });
});

test("undo keeps an input another step still reads", async () => {
  await inProject((steps, file) => {
    insertInput(steps, "name", "Ada");
    insertInput(steps, "name", "Ada");
    steps.undo(1);
    assert.match(readFileSync(file, "utf8"), /inputs: /);
    steps.undo(1);
    assert.doesNotMatch(readFileSync(file, "utf8"), /inputs: /);
  });
});

test("undo keeps an input the test declared before the run", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-undo-"));
  await withProject({ projectDir: dir, config: {} }, async () => {
    const first = new StepRecorder({ file: "a.spec.ts", create: "t" });
    insertInput(first, "name", "Ada");
    const again = new StepRecorder({ file: "a.spec.ts", test: "t" });
    insertInput(again, "name", "Ada");
    again.undo(1);
    assert.match(readFileSync(path.join(dir, "a.spec.ts"), "utf8"), /inputs: /);
  });
});
