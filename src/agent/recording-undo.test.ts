import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withProject } from "../runner/project.js";
import { StepRecorder } from "./recording.js";

async function inProject(work: (steps: StepRecorder, file: string) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-undo-"));
  await withProject({ projectDir: dir, config: {} }, async () => {
    const steps = new StepRecorder({ file: "a.spec.ts", create: "t" });
    work(steps, path.join(dir, "a.spec.ts"));
  });
}

const goto = (steps: StepRecorder, url: string) =>
  steps.observe({ type: "goto", url });

test("undo takes the last step out of the spec", async () => {
  await inProject((steps, file) => {
    goto(steps, "http://x.test/a");
    goto(steps, "http://x.test/b");
    assert.equal(steps.undo(1), 1);
    assert.equal(steps.count, 1);
    const source = readFileSync(file, "utf8");
    assert.match(source, /\/a/);
    assert.doesNotMatch(source, /\/b/);
  });
});

test("undo(n) takes out up to n steps and never more than the agent wrote", async () => {
  await inProject((steps, file) => {
    goto(steps, "http://x.test/a");
    goto(steps, "http://x.test/b");
    assert.equal(steps.undo(5), 2);
    assert.equal(steps.count, 0);
    assert.equal(steps.undo(1), 0);
    assert.doesNotMatch(readFileSync(file, "utf8"), /goto/);
  });
});

test("a step written after an undo goes in at the place the removed one had", async () => {
  await inProject((steps, file) => {
    goto(steps, "http://x.test/a");
    goto(steps, "http://x.test/b");
    steps.undo(1);
    goto(steps, "http://x.test/c");
    const source = readFileSync(file, "utf8");
    assert.ok(source.indexOf("/a") < source.indexOf("/c"));
    assert.doesNotMatch(source, /\/b/);
    assert.equal(steps.count, 2);
  });
});
