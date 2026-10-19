import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserConfig } from "../testing/test-browser.js";
import { runTests, type RunEvent } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

/**
 * `attempt(name)` counts how many times a test has run (a file per test next to the project), so a test can fail
 * until its n-th run. Every attempt saves a screenshot, to see where each one's files go.
 */
const HEAD = `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from ${API};
const attempt = (name) => {
  const file = path.join(process.env.ATTEMPTS_DIR, name);
  const n = (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0) + 1;
  writeFileSync(file, String(n));
  return n;
};
const open = (page) => page.navigateTo("data:text/html,<h1>Hi</h1>");
`;

function project(spec: string, config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-retries-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({ srcDir: "./specs", timeout: 30000, forbidOnly: false, ...browserConfig(), ...config })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(path.join(dir, "specs/shop.spec.ts"), HEAD + spec);
  const attempts = path.join(dir, "attempts");
  mkdirSync(attempts);
  process.env.ATTEMPTS_DIR = attempts;
  return {
    dir,
    ran: (name: string) =>
      existsSync(path.join(attempts, name))
        ? Number(readFileSync(path.join(attempts, name), "utf8"))
        : 0,
  };
}

const run = (dir: string, port: number, extra: object = {}) => {
  const events: RunEvent[] = [];
  const summary = runTests({
    projectDir: dir,
    dataDir: path.join(dir, "data"),
    headless: true,
    port,
    workers: 1,
    reportPath: false,
    onEvent: (event) => events.push(event),
    ...extra,
  });
  return summary.then((s) => ({ summary: s, events }));
};

const FLAKY = `
test("flaky", async ({ page }) => {
  await open(page);
  await page.screenshot({ name: "shot" });
  if (attempt("flaky") < 2) throw new Error("attempt 1 failed");
});
`;

test(
  "a test that passes on its retry is one flaky pass: two starts, one end, the earlier error kept",
  { timeout: 120000 },
  async () => {
    const { dir, ran } = project(FLAKY);
    const { summary, events } = await run(dir, 9311, { retries: 2 });

    assert.equal(
      summary.status,
      "success",
      "a flaky pass does not fail the run",
    );
    assert.equal(summary.tests.length, 1);
    const result = summary.tests[0] as unknown as Record<string, unknown> & {
      screenshots: { path: string }[];
      previousAttempts: { message: string }[];
    };
    assert.equal(result.status, "success");
    assert.equal(result.flaky, true);
    assert.equal(result.retry, 1);
    assert.equal(result.previousAttempts.length, 1);
    assert.match(result.previousAttempts[0]!.message, /attempt 1 failed/);
    assert.equal(ran("flaky"), 2);

    const starts = events.filter((e) => e.type === "test-start");
    assert.deepEqual(
      starts.map((e) => (e as { retry?: number }).retry),
      [undefined, 1],
    );
    assert.equal(events.filter((e) => e.type === "test-end").length, 1);

    assert.match(result.screenshots[0]!.path, /\/retry-1\/shot\.png$/);
    assert.ok(
      existsSync(path.join(dir, "result", result.screenshots[0]!.path)),
      "the retry's screenshot",
    );
    const first = result.screenshots[0]!.path.replace("/retry-1/", "/");
    assert.ok(
      existsSync(path.join(dir, "result", first)),
      "the first attempt's screenshot is kept apart",
    );
  },
);

test(
  "without retries a failing test fails at once, with no retry fields",
  { timeout: 120000 },
  async () => {
    const { dir, ran } = project(FLAKY);
    const { summary } = await run(dir, 9312);
    const result = summary.tests[0] as unknown as Record<string, unknown>;
    assert.equal(summary.status, "failed");
    assert.equal(result.status, "failed");
    assert.equal(ran("flaky"), 1);
    assert.equal(result.retry, undefined);
    assert.equal(result.previousAttempts, undefined);
  },
);

test(
  "a test that fails every attempt ends failed after the last one, with the errors before it",
  { timeout: 120000 },
  async () => {
    const { dir, ran } = project(`
test("always", async ({ page }) => {
  await open(page);
  throw new Error("attempt " + attempt("always") + " failed");
});
`);
    const { summary, events } = await run(dir, 9313, { retries: 2 });
    const result = summary.tests[0] as unknown as Record<string, unknown> & {
      previousAttempts: { message: string }[];
    };
    assert.equal(result.status, "failed");
    assert.equal(result.message, "attempt 3 failed");
    assert.equal(result.retry, 2);
    assert.deepEqual(
      result.previousAttempts.map((e) => e.message),
      ["attempt 1 failed", "attempt 2 failed"],
    );
    assert.equal(ran("always"), 3);
    assert.equal(events.filter((e) => e.type === "test-start").length, 3);
    assert.equal(events.filter((e) => e.type === "test-end").length, 1);
  },
);

test(
  "an aborted run does not retry the test that was running",
  { timeout: 120000 },
  async () => {
    const { dir, ran } = project(`
test("slow", async ({ page }) => {
  await open(page);
  attempt("slow");
  await page.waitForTimeout(30000);
});
`);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);
    const { summary } = await run(dir, 9314, {
      retries: 2,
      signal: controller.signal,
    });
    const result = summary.tests[0] as unknown as Record<string, unknown>;
    assert.equal(result.status, "failed");
    assert.equal(result.message, "Run aborted");
    assert.equal(ran("slow"), 1, "it ran once");
    assert.equal(result.retry, undefined);
  },
);

test(
  "on two workers each test is retried on its own and reported once",
  { timeout: 120000 },
  async () => {
    const { dir, ran } = project(`
for (const name of ["one", "two"])
  test(name, async ({ page }) => {
    await open(page);
    await page.waitForTimeout(800);
    if (attempt(name) < 2) throw new Error(name + " failed");
  });
`);
    const { summary, events } = await run(dir, 9315, {
      retries: 1,
      workers: 2,
    });
    assert.equal(summary.status, "success");
    assert.deepEqual(
      summary.tests.map((t) => [
        t.name,
        t.status,
        (t as { flaky?: boolean }).flaky,
      ]),
      [
        ["one", "success", true],
        ["two", "success", true],
      ],
    );
    assert.equal(ran("one"), 2);
    assert.equal(ran("two"), 2);
    assert.equal(events.filter((e) => e.type === "test-end").length, 2);
    const starts = events.filter((e) => e.type === "test-start");
    assert.equal(starts.length, 4);
    assert.equal(
      starts.filter((e) => (e as { retry?: number }).retry === 1).length,
      2,
    );
  },
);

test(
  "retries in the config apply, and the run option beats it",
  { timeout: 120000 },
  async () => {
    const config = project(FLAKY, { retries: 1 });
    const { summary } = await run(config.dir, 9316);
    assert.equal(summary.tests[0]?.status, "success");
    assert.equal(config.ran("flaky"), 2);

    const option = project(FLAKY, { retries: 1 });
    const { summary: off } = await run(option.dir, 9317, { retries: 0 });
    assert.equal(off.tests[0]?.status, "failed");
    assert.equal(option.ran("flaky"), 1);
  },
);
