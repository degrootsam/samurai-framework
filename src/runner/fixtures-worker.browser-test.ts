import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { testBrowser } from "../testing/test-browser.js";
import { runTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

/** A worker fixture next to a test fixture that uses it; both log their setup and teardown */
const FIXTURES = `
import { appendFileSync } from "node:fs";
import { test as base } from ${API};
export const log = (line) => appendFileSync(process.env.API_LOG, line + "\\n");
let made = 0;
export const test = base.extend({
  seedOptions: [{ size: 1 }, { option: true }],
  seed: [
    async ({ seedOptions, workerIndex }, use) => {
      const id = ++made;
      log("+seed" + id + " size=" + seedOptions.size);
      await use({ id, size: seedOptions.size, token: "t0ps3cret" });
      log("-seed" + id);
    },
    { scope: "worker", outputs: [{ name: "id" }, { name: "size" }, { name: "token", secret: true }] },
  ],
  row: async ({ seed, page }, use) => {
    log("+row" + seed.id);
    await page.navigateTo("data:text/html,<h1>Row</h1>");
    await use("row" + seed.id);
    log("-row");
  },
});
`;

function project(spec: string, config = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-fixtures-worker-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(path.join(dir, "fixtures.ts"), FIXTURES);
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `import { test as shop } from "./fixtures.ts";
export default {
  srcDir: "./specs", timeout: 30000, expect: { timeout: 1000 }, forbidOnly: false,
  browsers: [${JSON.stringify(testBrowser())}], fixtures: [shop], ${config}
};`,
  );
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(
    path.join(dir, "specs/shop.spec.ts"),
    `import { test, log } from "../fixtures.ts";\n${spec}`,
  );
  const apiLog = path.join(dir, "api.log");
  writeFileSync(apiLog, "");
  process.env.API_LOG = apiLog;
  return {
    dir,
    report: path.join(dir, "result/report.json"),
    lines: () => readFileSync(apiLog, "utf8").split("\n").filter(Boolean),
  };
}

const run = (dir: string, port: number, extra: object = {}) =>
  runTests({
    projectDir: dir,
    dataDir: path.join(dir, "data"),
    headless: true,
    port,
    workers: 1,
    ...extra,
  });

test(
  "a worker fixture is shared by the tests of a worker with the same options, and torn down when the worker is done",
  { timeout: 180000 },
  async () => {
    const { dir, lines, report } = project(`
test("first", async ({ seed, row }) => { log("first " + seed.id + " " + row); });
test("second", async ({ seed }) => { log("second " + seed.id); });
test.describe("bigger", () => {
  test.use({ seedOptions: { size: 2 } });
  test("third", async ({ seed }) => { log("third " + seed.id + " size=" + seed.size); });
});
test("fourth", async ({ seed }) => { log("fourth " + seed.id); });
`);
    const summary = await run(dir, 9811);
    assert.deepEqual(
      summary.tests.map((t) => t.status),
      ["success", "success", "success", "success"],
    );
    assert.deepEqual(lines(), [
      "+seed1 size=1",
      "+row1",
      "first 1 row1",
      "-row",
      "second 1",
      // other options, another instance
      "+seed2 size=2",
      "third 2 size=2",
      // the first instance is still there for the next test
      "fourth 1",
      // when the worker is done, last set up first
      "-seed2",
      "-seed1",
    ]);

    const json = JSON.parse(readFileSync(report, "utf8")) as {
      tests: Record<string, any>[];
    };
    const fixtures = (name: string) =>
      json.tests.find((t) => t.name === name)?.fixtures as
        Record<string, any>[] | undefined;
    const [seed, row] = fixtures("first")!;
    assert.equal(seed!.name, "seed");
    assert.equal(seed!.scope, "worker");
    assert.equal(seed!.setup.status, "passed");
    assert.equal(typeof seed!.setup.durationMs, "number");
    assert.equal(seed!.teardown, undefined);
    // the secret output is declared, so the test gets it, but the report does not
    assert.deepEqual(seed!.outputs, { id: 1, size: 1 });
    assert.equal(readFileSync(report, "utf8").includes("t0ps3cret"), false);
    assert.equal(row!.name, "row");
    assert.equal(row!.scope, "test");
    assert.equal(row!.teardown.status, "passed");
    // a later test only finds the instance, and reports it as skipped
    assert.equal(fixtures("second")![0]!.setup.status, "skipped");
    assert.equal(fixtures("second")!.length, 1);
  },
);

test(
  "a serial block stays on one worker process: its worker fixture is set up once and torn down at the end",
  { timeout: 180000 },
  async () => {
    const { dir, lines, report } = project(
      `
test.describe.serial("block", () => {
  test("a", async ({ seed }) => { log("a " + seed.id); });
  test("b", async ({ seed }) => { log("b " + seed.id); });
});
`,
      "workers: 2,",
    );
    const summary = await run(dir, 9812, { workers: 2 });
    assert.deepEqual(
      summary.tests.map((t) => t.status),
      ["success", "success"],
    );
    assert.deepEqual(lines(), ["+seed1 size=1", "a 1", "b 1", "-seed1"]);
    // the result crosses from the worker process to the report with its fixtures
    const json = JSON.parse(readFileSync(report, "utf8")) as {
      tests: Record<string, any>[];
    };
    assert.deepEqual(
      json.tests.map((t) => [t.name, t.fixtures?.[0]?.setup.status]),
      [
        ["block > a", "passed"],
        ["block > b", "skipped"],
      ],
    );
  },
);

test(
  "a worker fixture that fails to set up fails the test with the error and is tried again by the next",
  { timeout: 180000 },
  async () => {
    const { dir, lines } = project(`
let attempts = 0;
const t = test.extend({
  flaky: [async ({}, use) => { log("try"); if (attempts++ === 0) throw new Error("not yet"); await use("ok"); }, { scope: "worker" }],
});
t("fails", async ({ flaky }) => { log("must not run"); });
t("works", async ({ flaky }) => { log("works " + flaky); });
`);
    const summary = await run(dir, 9813);
    assert.deepEqual(
      summary.tests.map((t) => [t.name, t.status, "message" in t && t.message]),
      [
        ["fails", "failed", 'fixture "flaky" setup failed: not yet'],
        ["works", "success", false],
      ],
    );
    assert.deepEqual(lines(), ["try", "try", "works ok"]);
  },
);
