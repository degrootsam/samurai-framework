import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserConfig } from "../testing/test-browser.js";
import { runTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

/** `log(line)` appends to `api.log` next to the project; `logJSON(value)` appends a JSON line */
const HEAD = `
import { appendFileSync } from "node:fs";
import { test } from ${API};
const log = (line) => appendFileSync(process.env.API_LOG, line + "\\n");
const logJSON = (value) => log(JSON.stringify(value));
const open = (page) => page.navigateTo("data:text/html,<h1>Hi</h1>");
`;

function project(spec: string, config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-test-api-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({ srcDir: "./specs", timeout: 30000, expect: { timeout: 1000 }, forbidOnly: false, ...browserConfig(), ...config })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  const specFile = path.join(dir, "specs/shop.spec.ts");
  writeFileSync(specFile, HEAD + spec);
  const apiLog = path.join(dir, "api.log");
  writeFileSync(apiLog, "");
  process.env.API_LOG = apiLog;
  const lines = () => readFileSync(apiLog, "utf8").split("\n").filter(Boolean);
  return {
    dir,
    specFile,
    lines,
    json: () =>
      lines()
        .filter((l) => l.startsWith("{"))
        .map((l) => JSON.parse(l) as Record<string, any>),
  };
}

const run = (dir: string, port: number, extra: object = {}) =>
  runTests({
    projectDir: dir,
    dataDir: path.join(dir, "data"),
    headless: true,
    port,
    workers: 1,
    reportPath: false,
    ...extra,
  });

const byName = (summary: Awaited<ReturnType<typeof run>>) =>
  new Map(summary.tests.map((t) => [t.name, t as Record<string, any>]));

test(
  "test.step nests, returns values and lists steps; failing steps rethrow",
  { timeout: 120000 },
  async () => {
    const { dir } = project(`
const t = test.extend({ answer: 42 });
for (const [name, tt] of [["plain", test], ["extended", t]]) {
  tt(name + " steps", async ({ page }) => {
    await open(page);
    const title = await tt.step("read the heading", async () => {
      await tt.step("wait", async () => { await page.locator("h1").textContent(); });
      return page.locator("h1").textContent();
    });
    if (title !== "Hi") throw new Error("value lost: " + title);
    let caught;
    try { await tt.step("breaks", async () => { throw new Error("inner boom"); }); } catch (e) { caught = e.message; }
    if (caught !== "inner boom") throw new Error("not rethrown");
  });
}
test("failing step fails the test", async ({ page }) => {
  await test.step("explode", async () => { throw new Error("step failed"); });
});
test("no steps", async () => {});
`);
    const summary = await run(dir, 9360);
    const tests = byName(summary);
    for (const name of ["plain steps", "extended steps"]) {
      const result = tests.get(name);
      assert.equal(result?.status, "success", name);
      assert.deepEqual(
        result?.steps?.map((s: any) => [
          s.title,
          s.status,
          s.error,
          s.steps?.map((c: any) => c.title),
        ]),
        [
          ["read the heading", "passed", undefined, ["wait"]],
          ["breaks", "failed", "inner boom", undefined],
        ],
      );
      assert.equal(typeof result?.steps?.[0].duration, "number");
    }
    const failed = tests.get("failing step fails the test");
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.message, "step failed");
    assert.equal(failed?.steps?.[0].status, "failed");
    assert.equal("steps" in (tests.get("no steps") ?? {}), false);
  },
);

test(
  "test.fail flips the verdict: an expected failure passes, an unexpected pass fails",
  { timeout: 120000 },
  async () => {
    const { dir } = project(`
import { expect } from ${API};
test.fail("declared", async ({ page }) => {
  await open(page);
  await expect(page.locator("h1")).toHaveText("Nope");
});
test("inside the body", async ({ page, browserName }) => {
  test.fail();
  await open(page);
  await expect(page.locator("h1")).toHaveText("Nope");
});
test("with a condition", async ({ page }) => {
  test.fail(({ browserName }) => browserName.length > 0, "known bug");
  await open(page);
  throw new Error("still broken");
});
test("condition false", async ({ page }) => {
  test.fail(false);
  await open(page);
});
test("unexpectedly passes", async ({ page, testInfo }) => {
  test.fail();
  await open(page);
  if (testInfo.expectedStatus !== "failed") throw new Error("expectedStatus");
});
test.describe("group", () => {
  test.fail(true, "whole group");
  test("in group", async () => { throw new Error("x"); });
});
`);
    const summary = await run(dir, 9361);
    const tests = byName(summary);
    const status = (n: string) => tests.get(n)?.status;
    assert.equal(status("declared"), "success");
    assert.deepEqual(tests.get("declared")?.annotations, [{ type: "fail" }]);
    assert.equal(status("inside the body"), "success");
    assert.equal(status("with a condition"), "success");
    assert.deepEqual(tests.get("with a condition")?.annotations, [
      { type: "fail", description: "known bug" },
    ]);
    assert.equal(status("condition false"), "success");
    assert.equal("annotations" in (tests.get("condition false") ?? {}), false);
    assert.equal(status("unexpectedly passes"), "failed");
    assert.equal(
      tests.get("unexpectedly passes")?.message,
      "expected to fail, but passed",
    );
    assert.equal(status("group > in group"), "success");
    assert.deepEqual(tests.get("group > in group")?.annotations, [
      { type: "fail", description: "whole group" },
    ]);
  },
);

test(
  "test.slow triples the timeout and test.setTimeout re-arms it from the start of the test",
  { timeout: 120000 },
  async () => {
    const { dir, json } = project(
      `
test("slow", async ({ page, testInfo }) => {
  test.slow(true, "big");
  await open(page);
  logJSON({ timeout: testInfo.timeout });
});
test.describe("slow group", () => {
  test.slow(true);
  test("in group", async ({ page, testInfo }) => { await open(page); logJSON({ group: testInfo.timeout }); });
});
test("set low", async ({ page }) => {
  await open(page);
  test.setTimeout(400);
  await new Promise((r) => setTimeout(r, 5000));
});
test("set after time spent", async ({ page }) => {
  await open(page);
  await new Promise((r) => setTimeout(r, 1500));
  test.setTimeout(100); // already past: ends now
  await new Promise((r) => setTimeout(r, 5000));
});
test("set high", async ({ page }) => {
  test.setTimeout(20000);
  await open(page);
  await new Promise((r) => setTimeout(r, 1500));
});
`,
      { timeout: 4000 },
    );
    const started = Date.now();
    const summary = await run(dir, 9362);
    const tests = byName(summary);
    assert.deepEqual(json(), [{ timeout: 12000 }, { group: 12000 }]);
    assert.equal(tests.get("slow")?.status, "success");
    assert.deepEqual(tests.get("slow")?.annotations, [
      { type: "slow", description: "big" },
    ]);
    assert.equal(tests.get("slow group > in group")?.status, "success");
    assert.match(
      String(tests.get("set low")?.message),
      /^Test timed out after 0\.4 seconds$/,
    );
    assert.equal(tests.get("set low")?.type, "timeout");
    assert.match(
      String(tests.get("set after time spent")?.message),
      /after 0\.1 seconds$/,
    );
    // The 4 s default would also allow 1.5 s: the point is that raising it mid-test does not fail the test
    assert.equal(tests.get("set high")?.status, "success");
    assert.ok(Date.now() - started < 60000);
  },
);
