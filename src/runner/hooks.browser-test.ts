import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserConfig } from "../testing/test-browser.js";
import { runTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

/** The head of a spec: `log(line)` appends to `hooks.log` next to the project, in the order things happen */
const HEAD = `
import { appendFileSync } from "node:fs";
import { test, describe, beforeAll, afterAll, beforeEach, afterEach } from ${API};
const log = (line) => appendFileSync(process.env.HOOKS_LOG, line + "\\n");
const open = (page) => page.navigateTo("data:text/html,<h1>Hi</h1>");
`;

function project(spec: string, config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-hooks-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({ srcDir: "./specs", timeout: 30000, expect: { timeout: 1000 }, ...browserConfig(), ...config })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(path.join(dir, "specs/shop.spec.ts"), HEAD + spec);
  const hooksLog = path.join(dir, "hooks.log");
  writeFileSync(hooksLog, "");
  process.env.HOOKS_LOG = hooksLog;
  return {
    dir,
    lines: () => readFileSync(hooksLog, "utf8").split("\n").filter(Boolean),
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

test(
  "hooks run in order around each test, with a page, also after a failing test, and afterAll runs last",
  { timeout: 120000 },
  async () => {
    const { dir, lines } = project(`
describe("outer", () => {
  beforeAll(() => log("beforeAll outer"));
  afterAll(() => log("afterAll outer"));
  beforeEach(async ({ page }) => { log("beforeEach outer"); await open(page); });
  afterEach(async ({ page }) => { log("afterEach outer " + await page.getByCss("h1").textContent()); });
  describe("inner", () => {
    beforeEach(() => log("beforeEach inner"));
    afterEach(() => log("afterEach inner"));
    test("one", async () => { log("one"); });
    test("fails", async () => { log("fails"); throw new Error("body failed"); });
  });
  test("two", async () => { log("two"); });
});
`);
    const summary = await run(dir, 9301);

    assert.deepEqual(
      summary.tests.map((t) => [t.name, t.status]),
      [
        ["outer > inner > one", "success"],
        ["outer > inner > fails", "failed"],
        ["outer > two", "success"],
      ],
    );
    assert.match(JSON.stringify(summary.tests[1]), /body failed/);
    assert.deepEqual(lines(), [
      "beforeAll outer",
      "beforeEach outer",
      "beforeEach inner",
      "one",
      "afterEach inner",
      "afterEach outer Hi",
      "beforeEach outer",
      "beforeEach inner",
      "fails",
      "afterEach inner",
      "afterEach outer Hi",
      "beforeEach outer",
      "two",
      "afterEach outer Hi",
      "afterAll outer",
    ]);
  },
);

test(
  "a failing beforeEach fails the test with the hook's name, skips the body, and still runs afterEach",
  { timeout: 120000 },
  async () => {
    const { dir, lines } = project(`
beforeEach(() => { log("beforeEach"); throw new Error("no cart"); });
afterEach(() => log("afterEach"));
test("pays", async () => { log("body"); });
`);
    const summary = await run(dir, 9302);
    const result = summary.tests[0] as { status: string; message: string };
    assert.equal(result.status, "failed");
    assert.equal(result.message, "beforeEach hook failed: no cart");
    assert.deepEqual(lines(), ["beforeEach", "afterEach"]);
  },
);

test(
  "a failing afterEach fails a passing test",
  { timeout: 120000 },
  async () => {
    const { dir } = project(`
afterEach(() => { throw new Error("cleanup broke"); });
test("passes", async () => {});
`);
    const summary = await run(dir, 9303);
    const result = summary.tests[0] as { status: string; message: string };
    assert.equal(result.status, "failed");
    assert.equal(result.message, "afterEach hook failed: cleanup broke");
  },
);

test(
  "a failing beforeAll fails every test of its scope, and afterAll still runs",
  { timeout: 120000 },
  async () => {
    const { dir, lines } = project(`
describe("scope", () => {
  beforeAll(() => { log("beforeAll"); throw new Error("no data"); });
  afterAll(() => log("afterAll"));
  test("one", async () => { log("one"); });
  test("two", async () => { log("two"); });
});
test("outside", async () => { log("outside"); });
`);
    const summary = await run(dir, 9304);
    assert.deepEqual(
      summary.tests.map((t) => [
        t.name,
        t.status,
        (t as { message?: string }).message,
      ]),
      [
        ["scope > one", "failed", "beforeAll hook failed: no data"],
        ["scope > two", "failed", "beforeAll hook failed: no data"],
        ["outside", "success", undefined],
      ],
    );
    assert.deepEqual(lines(), ["beforeAll", "outside", "afterAll"]);
  },
);

test(
  "afterEach does not run after a timeout",
  { timeout: 120000 },
  async () => {
    const { dir, lines } = project(
      `
afterEach(() => log("afterEach"));
test("hangs", async ({ page }) => { await open(page); log("body"); await page.waitForTimeout(20000); });
`,
      { timeout: 2000 },
    );
    const summary = await run(dir, 9305);
    assert.equal(summary.tests[0]?.status, "failed");
    assert.match(JSON.stringify(summary.tests[0]), /timed out/);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(lines(), ["body"]);
  },
);

test(
  "on two workers, beforeAll runs once per worker and afterAll when the worker closes, after its tests",
  { timeout: 120000 },
  async () => {
    const { dir, lines } = project(`
describe("scope", () => {
  beforeAll(({ workerIndex }) => log("beforeAll " + workerIndex));
  afterAll(({ workerIndex }) => log("afterAll " + workerIndex));
  for (const name of ["a", "b", "c", "d"])
    test(name, async ({ page }) => { await open(page); await page.waitForTimeout(1200); log("test " + name); });
});
`);
    const summary = await run(dir, 9306, { workers: 2 });
    assert.equal(summary.status, "success");

    const all = lines();
    const before = all.filter((l) => l.startsWith("beforeAll"));
    const after = all.filter((l) => l.startsWith("afterAll"));
    assert.ok(
      before.length >= 1 && before.length <= 2,
      `once per worker: ${before}`,
    );
    assert.deepEqual(
      after.map((l) => l.split(" ")[1]).sort(),
      before.map((l) => l.split(" ")[1]).sort(),
      "every worker that ran a beforeAll ran its afterAll",
    );
    const lastTest = Math.max(
      ...all.flatMap((l, i) => (l.startsWith("test ") ? [i] : [])),
    );
    const firstAfter = Math.min(
      ...all.flatMap((l, i) => (l.startsWith("afterAll") ? [i] : [])),
    );
    assert.ok(firstAfter > lastTest, "afterAll comes after the tests");
  },
);
