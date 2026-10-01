import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runTests, type RunEvent } from "./run.js";

const API = path.resolve("src/api.ts");

function project(spec: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-project-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(
    path.join(dir, "specs/shop.spec.ts"),
    spec.replace("API", JSON.stringify(API)),
  );
  return dir;
}

const SPEC = `
import { expect, test } from API;
test("shows the heading", async ({ page }) => {
  await page.navigateTo("data:text/html,<h1>Hi</h1>");
  await expect(page.getByCss("h1")).toHaveText("Hi");
});
test("fails on purpose", async ({ page }) => {
  await page.navigateTo("data:text/html,<h1>Hi</h1>");
  await expect(page.getByCss("h1")).toHaveText("Bye", { timeout: 300 });
});
`;
const OPTIONS = { timeout: 90000 };

test(
  "runTests runs a project outside the working directory and reports events",
  OPTIONS,
  async () => {
    const dir = project(SPEC);
    const events: RunEvent[] = [];
    const summary = await runTests({
      projectDir: dir,
      config: { srcDir: "./specs", timeout: 30000, expect: { timeout: 1000 } },
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9251,
      onEvent: (event) => events.push(event),
    });

    assert.equal(summary.status, "failed");
    assert.deepEqual(
      summary.tests.map((t) => [t.name, t.status]),
      [
        ["shows the heading", "success"],
        ["fails on purpose", "failed"],
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
        "run-end",
      ],
    );
    assert.equal((events[0] as { total: number }).total, 2);
    const report = JSON.parse(
      readFileSync(path.join(dir, "result/report.json"), "utf8"),
    ) as typeof summary;
    assert.equal(report.tests.length, 2);
  },
);

test(
  "runTests selects tests by name and can run again in the same process",
  OPTIONS,
  async () => {
    const dir = project(SPEC);
    const run = (testNames: string[]) =>
      runTests({
        projectDir: dir,
        config: { srcDir: "./specs" },
        dataDir: path.join(dir, "data"),
        headless: true,
        port: 9252,
        reportPath: false,
        testNames,
      });
    const first = await run(["shows the heading"]);
    assert.deepEqual(
      first.tests.map((t) => t.name),
      ["shows the heading"],
    );
    assert.equal(first.status, "success");
    const second = await run(["fails on purpose"]);
    assert.deepEqual(
      second.tests.map((t) => t.name),
      ["fails on purpose"],
      "the registry starts empty again",
    );
  },
);

test(
  "an aborted run stops and reports the rest as aborted",
  OPTIONS,
  async () => {
    const dir = project(SPEC);
    const controller = new AbortController();
    controller.abort();
    const summary = await runTests({
      projectDir: dir,
      config: { srcDir: "./specs" },
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9253,
      reportPath: false,
      signal: controller.signal,
    });
    assert.equal(summary.status, "failed");
    assert.ok(
      summary.tests.every(
        (t) =>
          t.status === "failed" &&
          "message" in t &&
          t.message === "Run aborted",
      ),
    );
  },
);

test("a second run at the same time is refused", OPTIONS, async () => {
  const dir = project(SPEC);
  const options = {
    projectDir: dir,
    config: { srcDir: "./specs" },
    reportPath: false as const,
    headless: true,
    port: 9254,
    testNames: ["none"],
  };
  const first = runTests(options);
  await assert.rejects(runTests(options), /already active/);
  await first;
});

test(
  "a project that is not ES modules is refused with a clear message",
  OPTIONS,
  async () => {
    const dir = project(SPEC);
    writeFileSync(path.join(dir, "package.json"), "{}");
    await assert.rejects(
      runTests({
        projectDir: dir,
        config: { srcDir: "./specs" },
        reportPath: false,
        headless: true,
        port: 9256,
      }),
      /must set "type": "module"/,
    );
  },
);
