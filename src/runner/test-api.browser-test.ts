import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserConfig, testBrowser } from "../testing/test-browser.js";
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

test(
  "the aliases on test register and run in the same order as the named functions",
  { timeout: 120000 },
  async () => {
    const { dir, lines } = project(`
test.beforeAll(() => log("beforeAll"));
test.afterAll(() => log("afterAll"));
test.beforeEach(async ({ page }) => { log("beforeEach"); await open(page); });
test.afterEach(() => log("afterEach"));
test.describe("outer", () => {
  test.beforeEach(() => log("beforeEach outer"));
  test.afterEach(() => log("afterEach outer"));
  test.describe("inner", () => {
    test("one", async () => { log("one"); });
  });
  test.describe.skip("off", () => { test("never", async () => { throw new Error("must not run"); }); });
  test.describe.fixme("broken", () => { test("never", async () => { throw new Error("must not run"); }); });
});
`);
    const summary = await run(dir, 9331);
    assert.deepEqual(
      summary.tests.map((t) => [t.name, t.status]),
      [
        ["outer > inner > one", "success"],
        ["outer > off > never", "skipped"],
        ["outer > broken > never", "skipped"],
      ],
    );
    assert.deepEqual(lines(), [
      "beforeAll",
      "beforeEach",
      "beforeEach outer",
      "one",
      "afterEach outer",
      "afterEach",
      "afterAll",
    ]);
  },
);

test(
  "test.skip and test.fixme take a function of the fixtures; booleans work as before",
  { timeout: 120000 },
  async () => {
    const here = JSON.stringify(testBrowser());
    const other = JSON.stringify(
      testBrowser() === "chrome" ? "firefox" : "chrome",
    );
    const { dir } = project(`
test("skips on this browser", async ({ page }) => {
  await open(page);
  test.skip(({ browserName }) => browserName === ${here}, "not on this browser");
  throw new Error("must not run");
});
test("runs when the function is false", async ({ page }) => {
  await open(page);
  test.skip(({ browserName }) => browserName === ${other}, "never");
  log("ran");
});
test("fixme with a function", async () => {
  test.fixme(({ browserName }) => browserName === ${here}, "broken here");
  throw new Error("must not run");
});
test("a boolean still skips", async () => { test.skip(true, "plain"); throw new Error("must not run"); });
test("a false boolean does not", async () => { test.skip(false, "plain"); });
test.describe("in a hook", () => {
  test.beforeEach(({ browserName }) => { test.skip(browserName === ${here}, "hook skip"); });
  test("never runs here", async () => { throw new Error("must not run"); });
});
`);
    const summary = await run(dir, 9332);
    assert.deepEqual(
      summary.tests.map((t) => [
        t.name,
        t.status,
        "reason" in t ? t.reason : undefined,
      ]),
      [
        ["skips on this browser", "skipped", "not on this browser"],
        ["runs when the function is false", "success", undefined],
        ["fixme with a function", "skipped", "broken here"],
        ["a boolean still skips", "skipped", "plain"],
        ["a false boolean does not", "success", undefined],
        ["in a hook > never runs here", "skipped", "hook skip"],
      ],
    );
  },
);

test(
  "testInfo and test.info() describe the running test, also in hooks, and attachments are reported",
  { timeout: 120000 },
  async () => {
    const spec = `
test.describe("Cart", () => {
  test.beforeEach(async ({ page, testInfo }) => {
    await open(page);
    logJSON({ hook: "beforeEach", same: test.info() === testInfo, status: testInfo.status });
  });
  test.afterEach(({ testInfo }) => {
    logJSON({ hook: "afterEach", title: testInfo.title, status: testInfo.status, errors: testInfo.errors.map((e) => e.message) });
  });
  test("adds", async ({ testInfo, browserName }) => {
    logJSON({
      title: testInfo.title,
      titlePath: testInfo.titlePath,
      file: testInfo.file,
      line: testInfo.line,
      retry: testInfo.retry,
      workerIndex: testInfo.workerIndex,
      project: testInfo.project,
      config: testInfo.config,
      annotations: testInfo.annotations,
      status: testInfo.status,
      expectedStatus: testInfo.expectedStatus,
      browserName,
      outputDirInside: testInfo.outputDir.includes("attachments"),
    });
    testInfo.annotations.push({ type: "issue", description: "A-1" });
    await testInfo.attach("notes", { body: "hello" });
    await testInfo.attach("raw", { body: Buffer.from("x"), contentType: "application/octet-stream" });
  });
  test("fails", async () => { throw new Error("body failed"); });
});
test("flaky", async ({ testInfo }) => {
  logJSON({ flaky: true, retry: testInfo.retry });
  if (testInfo.retry === 0) throw new Error("first attempt");
});
`;
    const p = project(spec, { baseURL: "http://shop.test", retries: 1 });
    const summary = await run(p.dir, 9333, {
      reportPath: path.join(p.dir, "report.json"),
    });

    const byName: Record<string, any> = Object.fromEntries(
      summary.tests.map((t) => [t.name, t]),
    );
    assert.equal(byName["Cart > adds"].status, "success");
    assert.equal(byName["Cart > fails"].status, "failed");
    assert.equal(byName["flaky"].status, "success");
    assert.equal(byName["flaky"].retry, 1);

    const entries = p.json();
    const info = entries.find((e) => "titlePath" in e)!;
    assert.equal(info.title, "adds");
    assert.deepEqual(info.titlePath, ["Cart", "adds"]);
    assert.equal(info.file, p.specFile);
    const lineOfTest =
      readFileSync(p.specFile, "utf8")
        .split("\n")
        .findIndex((l) => l.includes('test("adds"')) + 1;
    assert.equal(info.line, lineOfTest);
    assert.equal(info.retry, 0);
    assert.equal(info.workerIndex, 0);
    assert.deepEqual(info.project, { name: testBrowser() });
    assert.equal(info.browserName, testBrowser());
    assert.deepEqual(info.config, {
      baseURL: "http://shop.test",
      timeout: 30000,
    });
    assert.deepEqual(info.annotations, []);
    assert.equal(info.status, undefined);
    assert.equal(info.expectedStatus, "passed");
    assert.equal(info.outputDirInside, true);

    const before = entries.filter((e) => e.hook === "beforeEach");
    assert.ok(before.every((h) => h.same && h.status === undefined));
    assert.deepEqual(
      entries
        .filter((e) => e.hook === "afterEach")
        .map((h) => [h.title, h.status, h.errors]),
      [
        ["adds", "passed", []],
        ["fails", "failed", ["body failed"]],
        // retries: 1 runs the failing test a second time
        ["fails", "failed", ["body failed"]],
      ],
    );
    assert.deepEqual(
      entries.filter((e) => e.flaky).map((e) => e.retry),
      [0, 1],
      "the retry counts from 0 and is 1 on the second attempt",
    );

    const adds = byName["Cart > adds"];
    assert.deepEqual(
      adds.attachments.map(
        (a: { name: string; contentType: string; path: string }) => [
          a.name,
          a.contentType,
          a.path.split("/").pop(),
        ],
      ),
      [
        ["notes", "text/plain", "notes.txt"],
        ["raw", "application/octet-stream", "raw.bin"],
      ],
    );
    assert.equal(
      readFileSync(path.join(p.dir, adds.attachments[0].path), "utf8"),
      "hello",
    );
    assert.deepEqual(adds.annotations, [{ type: "issue", description: "A-1" }]);
    assert.ok(
      !("attachments" in byName["Cart > fails"]),
      "no field when empty",
    );
    assert.ok(!("annotations" in byName["Cart > fails"]));

    const report = JSON.parse(
      readFileSync(path.join(p.dir, "report.json"), "utf8"),
    );
    assert.deepEqual(
      report.tests.find((t: { name: string }) => t.name === "Cart > adds")
        .attachments,
      adds.attachments,
    );
  },
);

test("test.info() outside a test says so", { timeout: 120000 }, async () => {
  const { dir, lines } = project(`
test.beforeAll(() => {
  try { test.info(); log("no error"); } catch (e) { log(e.message); }
});
test("t", async () => { log("ran"); });
`);
  const summary = await run(dir, 9334);
  assert.equal(summary.tests[0]?.status, "success");
  assert.deepEqual(lines(), ["info(): no test is running", "ran"]);
});

test(
  "context and baseURL are fixtures, and a test that reads neither is unaffected",
  { timeout: 120000 },
  async () => {
    const { dir, json } = project(
      `
test("reads them", async ({ page, context, baseURL }) => {
  await open(page);
  logJSON({
    sameContext: context === page.context(),
    hasPage: (await context.pages()).length >= 1,
    baseURL,
  });
});
test("whole fixtures object", async (fixtures) => {
  logJSON({ viaObject: fixtures.baseURL, hasContext: typeof fixtures.context.cookies });
});
test("asks for none", async () => { logJSON({ none: true }); });
`,
      { baseURL: "http://shop.test" },
    );
    const summary = await run(dir, 9335);
    assert.deepEqual(
      summary.tests.map((t) => t.status),
      ["success", "success", "success"],
    );
    assert.deepEqual(json(), [
      { sameContext: true, hasPage: true, baseURL: "http://shop.test" },
      { viaObject: "http://shop.test", hasContext: "function" },
      { none: true },
    ]);

    const noBase = project(`
test("no base", async ({ baseURL }) => { logJSON({ baseURL: baseURL ?? null }); });
`);
    await run(noBase.dir, 9336);
    assert.deepEqual(noBase.json(), [{ baseURL: null }]);
  },
);
