import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Page from "../../browser/page.js";
import { parseSpec } from "../../steps/parse.js";
import { StepRecorder } from "../recording.js";
import type { Snapshotter } from "../snapshot.js";
import type { ToolContext } from "./context.js";
import { createTools } from "./index.js";
import { OriginPolicy } from "./origins.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "add-steps-"));
let counter = 0;

function setup(options: { at?: number; file?: string } = {}) {
  const calls: string[] = [];
  const file = options.file ?? path.join(dir, `run-${++counter}.spec.ts`);
  const page = {
    screenshot: async () => calls.push("screenshot"),
    waitForTimeout: async (ms: number) => calls.push(`time ${ms}`),
    waitForNetworkIdle: async () => calls.push("idle"),
  } as unknown as Page;
  const steps = new StepRecorder(
    options.at === undefined
      ? { file, create: "t" }
      : { file, test: 0, at: options.at },
  );
  const context: ToolContext = {
    page,
    snapshots: {} as Snapshotter,
    steps,
    origins: new OriginPolicy(["http://localhost"]),
    secrets: { allowed: [], get: () => undefined },
    vision: false,
    actionTimeout: 1000,
    ask: async () => "",
    finish: () => undefined,
    emit: () => undefined,
    secretOnScreen: false,
  };
  const tools = new Map(createTools(context).map((t) => [t.name, t]));
  return {
    file,
    calls,
    call: (name: string, args: unknown) => tools.get(name)!.run(args),
    steps: () =>
      parseSpec(readFileSync(file, "utf8"))[0]!.steps.map(({ step }) => step),
  };
}

test("addScreenshot writes a screenshot step and takes no picture", async () => {
  const run = setup();
  const result = await run.call("addScreenshot", {
    name: "after-login",
    fullPage: true,
  });
  assert.equal(result.ok, true);
  assert.match(
    (result as { message: string }).message,
    /none was taken now.*page\.screenshot\(\{ name: "after-login", fullPage: true \}\)/,
  );
  assert.deepEqual(run.steps(), [
    { kind: "screenshot", name: "after-login", fullPage: true },
  ]);
  await run.call("addScreenshot", { name: "plain" });
  assert.deepEqual(run.steps()[1], {
    kind: "screenshot",
    name: "plain",
    fullPage: false,
  });
  assert.deepEqual(run.calls, []);
});

test("addScreenshot refuses a name the file cannot keep, and writes nothing", async () => {
  const run = setup();
  for (const name of ["", "a b", "../x", "é", "x".repeat(61)]) {
    const result = await run.call("addScreenshot", { name });
    assert.equal(result.ok, false, name);
    assert.match(
      (result as { error: string }).error,
      /^addScreenshot\(\): name must be 1 to 60 characters/,
    );
  }
  assert.deepEqual(run.steps(), []);
});

test("undo removes a step written by addScreenshot or wait", async () => {
  const run = setup();
  await run.call("addScreenshot", { name: "one" });
  await run.call("wait", { for: "networkIdle" });
  assert.equal(run.steps().length, 2);
  await run.call("undo", { count: 2 });
  assert.deepEqual(run.steps(), []);
});

test("wait writes the two wait steps and runs them on the page", async () => {
  const run = setup();
  assert.equal((await run.call("wait", { for: "time", ms: 250 })).ok, true);
  assert.equal((await run.call("wait", { for: "networkIdle" })).ok, true);
  assert.deepEqual(run.steps(), [
    { kind: "waitForTimeout", ms: 250 },
    { kind: "waitForNetworkIdle" },
  ]);
  assert.deepEqual(run.calls, ["time 250", "idle"]);
});

test("wait refuses a call that does not fit, and writes nothing", async () => {
  const run = setup();
  const cases: [unknown, RegExp][] = [
    [{ for: "time" }, /time needs ms/],
    [{ for: "networkIdle", ms: 5 }, /only for time/],
    [{ for: "time", ms: -1 }, /invalid arguments/],
    [{ for: "time", ms: 30001 }, /invalid arguments/],
    [{ for: "time", ms: 1.5 }, /invalid arguments/],
    [{ for: "forever" }, /invalid arguments/],
  ];
  for (const [args, error] of cases) {
    const result = await run.call("wait", args);
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, error);
  }
  assert.deepEqual(run.steps(), []);
  assert.deepEqual(run.calls, []);
});

test("in continue mode the steps go at the continue index, before the later ones", async () => {
  const first = setup();
  await first.call("addScreenshot", { name: "a" });
  await first.call("addScreenshot", { name: "c" });
  const run = setup({ file: first.file, at: 1 });
  await run.call("addScreenshot", { name: "b" });
  await run.call("wait", { for: "time", ms: 10 });
  assert.deepEqual(
    run.steps().map((s) => (s.kind === "screenshot" ? s.name : s.kind)),
    ["a", "b", "waitForTimeout", "c"],
  );
  await run.call("undo", { count: 5 });
  assert.deepEqual(
    run.steps().map((s) => (s.kind === "screenshot" ? s.name : s.kind)),
    ["a", "c"],
  );
});
