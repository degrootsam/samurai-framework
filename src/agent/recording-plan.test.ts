import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withProject } from "../runner/project.js";
import { parseSpec } from "../steps/parse.js";
import { StepRecorder } from "./recording.js";

const PLAN = { type: "plan", description: "plans/pay.plan.md" };

async function inProject(
  work: (dir: string) => void,
  existing?: string,
): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-plan-"));
  if (existing !== undefined)
    writeFileSync(path.join(dir, "a.spec.ts"), existing);
  await withProject({ projectDir: dir, config: {} }, async () => work(dir));
  return readFileSync(path.join(dir, "a.spec.ts"), "utf8");
}

test("a new test made from a plan carries the plan annotation, and its steps follow", async () => {
  const source = await inProject(() => {
    const steps = new StepRecorder({
      file: "a.spec.ts",
      create: "t",
      planFile: "plans/pay.plan.md",
    });
    steps.observe({ type: "goto", url: "http://x.test/a" });
    steps.observe({ type: "goto", url: "http://x.test/b" });
    steps.undo(1);
  });
  const [parsed] = parseSpec(source);
  assert.deepEqual(parsed!.annotations, [PLAN]);
  assert.equal(parsed!.steps.length, 1);
});

test("a run without a plan writes no annotation", async () => {
  const source = await inProject(() => {
    new StepRecorder({ file: "a.spec.ts", create: "t" });
  });
  assert.doesNotMatch(source, /annotations/);
});

test("an existing test keeps its other annotations and gets its plan replaced", async () => {
  const existing = `import { test } from "@itmetsam/samurai-framework";\n\ntest("t", { annotations: [{ type: "plan", description: "plans/old.plan.md" }, { type: "issue", description: "P-1" }] }, async ({ page }) => {\n});\n`;
  const source = await inProject(() => {
    new StepRecorder({
      file: "a.spec.ts",
      test: "t",
      planFile: "plans/pay.plan.md",
    });
  }, existing);
  assert.deepEqual(parseSpec(source)[0]!.annotations, [
    PLAN,
    { type: "issue", description: "P-1" },
  ]);
});

test("the same plan twice leaves the file as it is", async () => {
  const first = await inProject((dir) => {
    new StepRecorder({
      file: "a.spec.ts",
      create: "t",
      planFile: "plans/pay.plan.md",
    });
    void dir;
  });
  const second = await inProject(() => {
    new StepRecorder({
      file: "a.spec.ts",
      test: "t",
      planFile: "plans/pay.plan.md",
    });
  }, first);
  assert.equal(second, first);
});
