import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserConfig } from "../testing/test-browser.js";
import { runTests } from "./run.js";

const API = path.resolve("src/api.ts");

/** One spec file: each test logs when it starts and ends (and its worker) to `times.log` next to the project, and stays up for `HOLD` ms */
function spec(names: string[], hold = 1500, body = "") {
  return `
import { appendFileSync } from "node:fs";
import { test } from ${JSON.stringify(API)};
const log = (line) => appendFileSync(process.env.TIMES_LOG, line + "\\n");
${names
  .map(
    (name) => `test(${JSON.stringify(name)}, async ({ page, workerIndex }) => {
  log("start " + ${JSON.stringify(name)} + " " + Date.now() + " " + workerIndex);
  await page.navigateTo("data:text/html,<h1>Hi</h1>");
  ${body}
  await page.waitForTimeout(${hold});
  log("end " + ${JSON.stringify(name)} + " " + Date.now() + " " + workerIndex);
});`,
  )
  .join("\n")}
`;
}

function project(files: Record<string, string>, config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-workers-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({
      srcDir: "./specs",
      timeout: 30000,
      ...browserConfig(),
      ...config,
    })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  for (const [name, source] of Object.entries(files))
    writeFileSync(path.join(dir, "specs", name), source);
  const timesLog = path.join(dir, "times.log");
  writeFileSync(timesLog, "");
  process.env.TIMES_LOG = timesLog;
  return { dir, timesLog };
}

interface Span {
  name: string;
  start: number;
  end: number;
  worker: number;
}

function spans(timesLog: string): Span[] {
  const found = new Map<string, Span>();
  for (const line of readFileSync(timesLog, "utf8").split("\n")) {
    const [kind, name, time, worker] = line.split(" ").slice(0, 4);
    if (!kind || !name) continue;
    const span = found.get(name) ?? {
      name,
      start: 0,
      end: 0,
      worker: Number(worker),
    };
    if (kind === "start") span.start = Number(time);
    else span.end = Number(time);
    found.set(name, span);
  }
  return [...found.values()];
}

/** The most tests that were running at the same moment */
function peak(list: Span[]): number {
  let most = 0;
  for (const { start } of list)
    most = Math.max(
      most,
      list.filter((s) => s.start <= start && start < s.end).length,
    );
  return most;
}

test(
  "two workers run four tests two at a time, and the report keeps the test order",
  { timeout: 120000 },
  async () => {
    const { dir, timesLog } = project({
      "shop.spec.ts": spec(["one", "two", "three", "four"]),
    });
    const summary = await runTests({
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9271,
      workers: 2,
    });

    assert.equal(summary.status, "success");
    assert.deepEqual(
      summary.tests.map((t) => t.name),
      ["one", "two", "three", "four"],
    );
    const list = spans(timesLog);
    assert.equal(list.length, 4);
    assert.equal(peak(list), 2, "two ran at the same time, never more");
    assert.deepEqual(
      [...new Set(list.map((s) => s.worker))].sort(),
      [0, 1],
      "the workerIndex fixture names the worker",
    );
    const report = JSON.parse(
      readFileSync(path.join(dir, "result/report.json"), "utf8"),
    ) as { tests: { name: string; worker?: number }[] };
    assert.deepEqual(
      report.tests.map((t) => t.name),
      ["one", "two", "three", "four"],
    );
    assert.ok(report.tests.every((t) => typeof t.worker === "number"));
  },
);

test(
  "one worker keeps the tests in this process, one after the other",
  { timeout: 120000 },
  async () => {
    const { dir, timesLog } = project({
      "shop.spec.ts": spec(["one", "two"], 300),
    });
    const summary = await runTests({
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9272,
      workers: 1,
    });
    assert.equal(summary.status, "success");
    assert.equal(peak(spans(timesLog)), 1);
  },
);

test(
  "a test that kills its worker fails, the worker is replaced and the rest still run",
  { timeout: 120000 },
  async () => {
    const { dir } = project({
      "a.spec.ts": spec(["crashes"], 100, "process.exit(1);"),
      "b.spec.ts": spec(["survives one", "survives two"], 300),
    });
    const summary = await runTests({
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9273,
      workers: 2,
      reportPath: false,
    });

    const byName = Object.fromEntries(summary.tests.map((t) => [t.name, t]));
    assert.equal(byName.crashes?.status, "failed");
    assert.match(
      JSON.stringify(byName.crashes),
      /The worker process exited \(code 1\)/,
    );
    assert.equal(byName["survives one"]?.status, "success");
    assert.equal(byName["survives two"]?.status, "success");
  },
);

test(
  "an abort ends a pooled run: the running tests stop and the queued ones are reported as aborted",
  { timeout: 120000 },
  async () => {
    const { dir } = project({
      "slow.spec.ts": spec(["a", "b", "c", "d"], 60000),
    });
    const controller = new AbortController();
    const begun = Date.now();
    setTimeout(() => controller.abort(), 4000);
    const summary = await runTests({
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9274,
      workers: 2,
      reportPath: false,
      signal: controller.signal,
    });

    assert.ok(Date.now() - begun < 40000, "the run did not wait for the tests");
    assert.equal(summary.tests.length, 4);
    assert.ok(summary.tests.every((t) => t.status === "failed"));
  },
);

test(
  "a group with workers: 1 never runs two of its tests at the same time",
  { timeout: 120000 },
  async () => {
    const { dir, timesLog } = project(
      {
        "serial.spec.ts": spec(["s1", "s2"], 1200),
        "free.spec.ts": spec(["f1", "f2"], 1200),
      },
      {
        groups: [
          { name: "serial", testMatch: "**/serial.spec.ts", workers: 1 },
          { name: "free", testMatch: "**/free.spec.ts" },
        ],
      },
    );
    const summary = await runTests({
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9275,
      workers: 4,
      reportPath: false,
    });

    assert.equal(summary.status, "success");
    const list = spans(timesLog);
    assert.equal(
      peak(list.filter((s) => s.name.startsWith("s"))),
      1,
      "the serial group's tests do not overlap",
    );
    assert.ok(
      peak(list) >= 2,
      "tests of the other group (or the other tests) still overlap",
    );
  },
);
