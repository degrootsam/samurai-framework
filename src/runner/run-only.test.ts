import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { SamuraiTestConfig } from "../types/config.js";
import { listTests, runTests, type TestSummary } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
let dir: string;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "samurai-only-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(dir, "src"));
  writeFileSync(
    path.join(dir, "src/a.spec.ts"),
    `import { test, describe } from ${API};
test("plain", async () => {});
test.only("focused", async () => {});
describe.only("block", () => { test("inside", async () => {}); });`,
  );
});

after(() => rmSync(dir, { recursive: true, force: true }));

const run = (config: SamuraiTestConfig): Promise<TestSummary> =>
  // Nothing matches, so no browser opens
  runTests({
    projectDir: dir,
    config,
    grep: "nothing matches this",
    reportPath: false,
  });

describe("forbidOnly", () => {
  it("stops the run before it starts and lists every focused test", async () => {
    await assert.rejects(run({ forbidOnly: true }), (error: Error) => {
      assert.equal(
        error.message,
        [
          "test.only is not allowed (forbidOnly): a.spec.ts: focused",
          "test.only is not allowed (forbidOnly): a.spec.ts: block > inside",
        ].join("\n"),
      );
      return true;
    });
  });

  it("is on by default when CI is set, and off without it", async () => {
    const before = process.env.CI;
    try {
      process.env.CI = "true";
      await assert.rejects(run({}), /forbidOnly/);
      process.env.CI = "";
      assert.equal((await run({})).status, "success");
    } finally {
      if (before === undefined) delete process.env.CI;
      else process.env.CI = before;
    }
  });

  it("can be turned off in the config even on CI", async () => {
    const before = process.env.CI;
    try {
      process.env.CI = "true";
      assert.equal((await run({ forbidOnly: false })).status, "success");
    } finally {
      if (before === undefined) delete process.env.CI;
      else process.env.CI = before;
    }
  });

  it("is not checked when tests are only listed", async () => {
    const tests = await listTests({
      projectDir: dir,
      config: { forbidOnly: true },
    });
    assert.deepEqual(
      tests.map((t) => t.name),
      ["plain", "focused", "block > inside"],
    );
  });
});

describe("skipped tests", () => {
  it("are reported without a browser, and a run of only skipped tests succeeds", async () => {
    const skipDir = mkdtempSync(path.join(tmpdir(), "samurai-skip-"));
    // No browser is installed: a run that only skips must not ask for one (as on a CI runner)
    const cache = process.env.SAMURAI_BROWSERS_PATH;
    process.env.SAMURAI_BROWSERS_PATH = path.join(skipDir, "no-browsers");
    try {
      writeFileSync(path.join(skipDir, "package.json"), '{"type":"module"}');
      mkdirSync(path.join(skipDir, "src"));
      writeFileSync(
        path.join(skipDir, "src/a.spec.ts"),
        `import { test, describe } from ${API};
test.skip("skipped", async () => {});
test.fixme("broken", async () => {});
describe.skip("block", () => { test("inside", async () => {}); });`,
      );
      const events: { type: string; name?: string }[] = [];
      const summary = await runTests({
        projectDir: skipDir,
        config: {},
        reportPath: false,
        onEvent: (event) =>
          events.push({
            type: event.type,
            ...("name" in event && { name: event.name }),
          }),
      });

      assert.equal(summary.status, "success");
      assert.deepEqual(
        summary.tests.map((t) => [t.name, t.status]),
        [
          ["skipped", "skipped"],
          ["broken", "skipped"],
          ["block > inside", "skipped"],
        ],
      );
      assert.deepEqual(
        events.map((e) => e.type),
        [
          "run-start",
          "test-start",
          "test-end",
          "test-start",
          "test-end",
          "test-start",
          "test-end",
          "run-end",
        ],
      );
    } finally {
      if (cache === undefined) delete process.env.SAMURAI_BROWSERS_PATH;
      else process.env.SAMURAI_BROWSERS_PATH = cache;
      rmSync(skipDir, { recursive: true, force: true });
    }
  });
});
