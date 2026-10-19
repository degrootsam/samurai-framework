import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserConfig } from "../testing/test-browser.js";
import { runTests, type RunEvent } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

const SPEC = `
import { expect, test, describe } from ${API};
const open = (page) => page.navigateTo("data:text/html,<h1>Hi</h1>");
test("passes", async ({ page }) => { await open(page); await expect(page.getByCss("h1")).toHaveText("Hi"); });
test.skip("skipped", async () => { throw new Error("must not run"); });
test.fixme("broken", async () => { throw new Error("must not run"); });
describe.skip("block", () => { test("inside", async () => { throw new Error("must not run"); }); });
test("skips itself", async ({ page }) => { await open(page); test.skip(true, "needs another browser"); throw new Error("must not run"); });
test("does not skip when the condition is false", async ({ page }) => { await open(page); test.skip(false, "never"); });
test("fails", async ({ page }) => { await open(page); await expect(page.getByCss("h1")).toHaveText("Bye", { timeout: 300 }); });
`;

function project(spec: string, config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-modifiers-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({ srcDir: "./specs", timeout: 30000, expect: { timeout: 1000 }, forbidOnly: false, ...browserConfig(), ...config })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(path.join(dir, "specs/shop.spec.ts"), spec);
  return dir;
}

for (const [workers, port] of [
  [1, 9291],
  [2, 9292],
] as const) {
  test(
    `skip, fixme, describe.skip and a runtime skip are reported as skipped (${workers} worker${workers > 1 ? "s" : ""})`,
    { timeout: 120000 },
    async () => {
      const dir = project(SPEC);
      const events: RunEvent[] = [];
      const summary = await runTests({
        projectDir: dir,
        dataDir: path.join(dir, "data"),
        headless: true,
        port,
        workers,
        reportPath: false,
        onEvent: (event) => events.push(event),
      });

      assert.equal(summary.status, "failed", "the failing test fails the run");
      assert.deepEqual(
        summary.tests.map((t) => [t.name, t.status]),
        [
          ["passes", "success"],
          ["skipped", "skipped"],
          ["broken", "skipped"],
          ["block > inside", "skipped"],
          ["skips itself", "skipped"],
          ["does not skip when the condition is false", "success"],
          ["fails", "failed"],
        ],
      );
      const byName = Object.fromEntries(
        summary.tests.map((t) => [
          t.name,
          t as unknown as Record<string, unknown>,
        ]),
      );
      assert.equal(byName.skipped?.annotation, "skip");
      assert.equal(byName.broken?.annotation, "fixme");
      assert.equal(byName["skips itself"]?.reason, "needs another browser");
      assert.equal(byName.skipped?.duration, 0);

      assert.equal((events[0] as { total: number }).total, 7);
      const ends = events.filter((e) => e.type === "test-end");
      const starts = events.filter((e) => e.type === "test-start");
      assert.equal(ends.length, 7, "one end per test");
      assert.equal(starts.length, 7, "one start per test, skipped ones too");
    },
  );
}

test(
  "a run with only skipped and passing tests succeeds",
  { timeout: 120000 },
  async () => {
    const dir = project(`
import { test } from ${API};
test("passes", async ({ page }) => { await page.navigateTo("data:text/html,<h1>Hi</h1>"); });
test.skip("skipped", async () => {});
`);
    const summary = await runTests({
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9293,
      reportPath: false,
    });
    assert.equal(summary.status, "success");
    assert.deepEqual(
      summary.tests.map((t) => t.status),
      ["success", "skipped"],
    );
  },
);

test(
  "test.only runs only the focused tests, and the others are not reported",
  { timeout: 120000 },
  async () => {
    const dir = project(`
import { test, describe } from ${API};
const open = (page) => page.navigateTo("data:text/html,<h1>Hi</h1>");
test("plain", async ({ page }) => { await open(page); });
test.only("focused", async ({ page }) => { await open(page); });
describe.only("block", () => { test("inside", async ({ page }) => { await open(page); }); });
`);
    const summary = await runTests({
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9294,
      reportPath: false,
    });
    assert.equal(summary.status, "success");
    assert.deepEqual(
      summary.tests.map((t) => t.name),
      ["focused", "block > inside"],
    );
  },
);
