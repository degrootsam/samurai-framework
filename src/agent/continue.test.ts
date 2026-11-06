import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withProject } from "../runner/project.js";
import { generateKind } from "./generate-kind.js";
import { buildSystemPrompt } from "./prompt.js";
import { StepRecorder } from "./recording.js";
import type { AgentOptions } from "./types.js";

const SPEC = `import { test } from "@itmetsam/samurai-framework";

test("checkout", { inputs: { who: "bob" } }, async ({ page }) => {
  await page.goto("/shop");
  await page.getByTestId("a").click();
  await page.getByTestId("b").click();
});
`;

async function inProject(
  work: (dir: string, file: string) => void | Promise<void>,
) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-continue-"));
  const file = path.join(dir, "a.spec.ts");
  writeFileSync(file, SPEC);
  await withProject({ projectDir: dir, config: {} }, async () =>
    work(dir, file),
  );
}

const options = (extra: Partial<AgentOptions>): AgentOptions => ({
  model: {} as never,
  goal: "g",
  file: "a.spec.ts",
  test: "checkout",
  ...extra,
});

test("a recorder at an index splits the test and writes between the halves", async () => {
  await inProject((_dir, file) => {
    const steps = new StepRecorder({ file: "a.spec.ts", test: 0, at: 1 });
    assert.deepEqual(
      steps.before.map((s) => s.kind),
      ["goto"],
    );
    assert.equal(steps.after.length, 2);
    assert.deepEqual(steps.inputs, [{ name: "who", default: "bob" }]);
    assert.equal(steps.continuing, true);
    assert.equal(steps.count, 1);
    steps.observe({ type: "goto", url: "http://x.test/new" });
    const source = readFileSync(file, "utf8");
    assert.ok(source.indexOf("/shop") < source.indexOf("/new"));
    assert.ok(source.indexOf("/new") < source.indexOf('getByTestId("a")'));
    // undo never removes the steps that were already there
    assert.equal(steps.undo(5), 1);
    assert.equal(readFileSync(file, "utf8"), SPEC);
  });
});

test("continueAt is checked before the browser opens", async () => {
  await inProject(() => {
    const input = { baseURL: undefined, emit: () => undefined };
    assert.throws(
      () => generateKind.sink(options({ continueAt: 4 }), input),
      /continueAt must be between 0 and 3/,
    );
    assert.throws(
      () => generateKind.sink(options({ continueAt: 1.5 }), input),
      /continueAt must be between 0 and 3/,
    );
    assert.throws(
      () => generateKind.sink(options({ continueAt: -1 }), input),
      /continueAt must be between 0 and 3/,
    );
    assert.throws(
      () => generateKind.sink(options({ continueAt: 1, create: "new" }), input),
      /continueAt needs an existing test/,
    );
    const { test: _test, ...withoutTest } = options({ continueAt: 1 });
    assert.throws(
      () => generateKind.sink(withoutTest, input),
      /continueAt needs an existing test/,
    );
    assert.equal(generateKind.sink(options({ continueAt: 0 }), input).count, 0);
  });
});

test("the first message lists the replayed and the following steps", async () => {
  await inProject(() => {
    const opts = options({ continueAt: 2 });
    const sink = generateKind.sink(opts, {
      baseURL: undefined,
      emit: () => undefined,
    });
    const text = generateKind.opening(opts, "PAGE", sink);
    assert.match(text, /replaying the first 2 steps of the test/);
    assert.match(
      text,
      /1\. await page\.goto\("\/shop"\);\n2\. await page\.getByTestId\("a"\)\.click\(\);/,
    );
    assert.match(
      text,
      /AFTER the ones you write[^]*3\. await page\.getByTestId\("b"\)\.click\(\);/,
    );
    assert.match(text, /PAGE$/);
    const none = generateKind.sink(options({ continueAt: 0 }), {
      baseURL: undefined,
      emit: () => undefined,
    });
    assert.match(
      generateKind.opening(options({ continueAt: 0 }), "PAGE", none),
      /No steps were replayed/,
    );
  });
});

test("a normal run's first message and prompt have no continue text", async () => {
  await inProject(() => {
    const opts = options({});
    const sink = generateKind.sink(opts, {
      baseURL: undefined,
      emit: () => undefined,
    });
    assert.equal(generateKind.opening(opts, "PAGE", sink), "Goal: g\n\nPAGE");
    const base = {
      instructions: "",
      fixtures: [],
      secrets: [],
      origins: [],
      vision: false,
    };
    assert.doesNotMatch(buildSystemPrompt(base), /Continuing a test/);
    assert.match(
      buildSystemPrompt({ ...base, hasContinue: true }),
      /Continuing a test/,
    );
  });
});
