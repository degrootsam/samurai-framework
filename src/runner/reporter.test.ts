import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import TestReporter from "./reporter.js";
import { runWithRetries } from "./retry.js";
import { MASK, registerSecret, resetSecrets } from "../config/mask.js";
import type { RegisteredTestCase } from "../types/test.js";
import { newSuite } from "./suite.js";

const dir = mkdtempSync(path.join(tmpdir(), "samurai-reporter-"));
after(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => resetSecrets());

function testCase(file: string, name: string): RegisteredTestCase {
  return {
    file,
    name,
    titlePath: name.split(" > "),
    suite: newSuite(),
    function: async () => {},
  };
}

async function report(run: (reporter: TestReporter) => void) {
  const output = path.join(dir, `${Math.random()}.json`);
  const reporter = new TestReporter({
    environment: "staging",
    browsers: ["firefox"],
    output,
  });
  reporter.onStart(0);
  run(reporter);
  await reporter.onEnd();
  return JSON.parse(readFileSync(output, "utf8"));
}

test("records the environment", async () => {
  const summary = await report(() => {});
  assert.equal(summary.environment, "staging");
});

test("tests with the same title in different files are kept apart", async () => {
  const a = testCase("a.spec.ts", "Checkout > pays");
  const b = testCase("b.spec.ts", "Checkout > pays");
  const summary = await report((reporter) => {
    reporter.onTestStart(a, "firefox");
    reporter.onTestStart(b, "firefox");
    reporter.onTestEnd(a, "firefox");
    reporter.onTestEnd(b, "firefox", { message: "boom", type: "error" });
  });
  assert.deepEqual(
    summary.tests.map((t: { file: string; name: string; status: string }) => [
      t.file,
      t.name,
      t.status,
    ]),
    [
      ["a.spec.ts", "Checkout > pays", "success"],
      ["b.spec.ts", "Checkout > pays", "failed"],
    ],
  );
});

test("masks secrets in errors and logs", async () => {
  registerSecret("TEST_CARD", "4242424242424242");
  const t = testCase("a.spec.ts", "pays");
  const summary = await report((reporter) => {
    reporter.onTestStart(t, "firefox");
    reporter.onTestEnd(
      t,
      "firefox",
      {
        message: 'expected "4242424242424242"',
        type: "assertion",
        stack: "AssertionError: expected 4242424242424242\n    at x",
        expected: "4242424242424242",
        actual: "4242",
      },
      {
        logs: [
          {
            level: "info",
            type: "console",
            text: "card 4242424242424242",
            timestamp: 1,
          },
        ],
      },
    );
  });
  const [result] = summary.tests;
  assert.equal(result.message, `expected "${MASK}"`);
  assert.equal(result.expected, MASK);
  assert.equal(result.actual, "4242");
  assert.doesNotMatch(result.stack, /4242424242424242/);
  assert.equal(result.logs[0].text, `card ${MASK}`);
});

test("the same test in two browsers gives two results, each with its browser", async () => {
  const t = testCase("a.spec.ts", "pays");
  const output = path.join(dir, `${Math.random()}.json`);
  const events: { type: string; browser?: string }[] = [];
  const reporter = new TestReporter({
    environment: "staging",
    browsers: ["firefox", "chrome"],
    output,
    onEvent: (event) =>
      events.push({
        type: event.type,
        ...("browser" in event && { browser: event.browser }),
      }),
  });
  reporter.onStart(2);
  reporter.onTestStart(t, "firefox");
  reporter.onTestEnd(t, "firefox");
  reporter.onTestStart(t, "chrome");
  reporter.onTestEnd(t, "chrome", { message: "boom", type: "error" });
  const summary = await reporter.onEnd();
  assert.deepEqual(
    summary.tests.map((r) => [r.name, "browser" in r && r.browser, r.status]),
    [
      ["pays", "firefox", "success"],
      ["pays", "chrome", "failed"],
    ],
  );
  assert.deepEqual(summary.browsers, ["firefox", "chrome"]);
  assert.equal(summary.status, "failed", "one failing browser fails the run");
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")).browsers, [
    "firefox",
    "chrome",
  ]);
  assert.deepEqual(
    events.map((e) => `${e.type}${e.browser ? `:${e.browser}` : ""}`),
    [
      "run-start",
      "test-start:firefox",
      "test-end:firefox",
      "test-start:chrome",
      "test-end:chrome",
      "run-end",
    ],
  );
});

test("run-start carries the total and the browsers", async () => {
  const seen: unknown[] = [];
  const reporter = new TestReporter({
    environment: "staging",
    browsers: ["chrome"],
    output: false,
    onEvent: (event) => event.type === "run-start" && seen.push(event),
  });
  reporter.onStart(6);
  assert.deepEqual(seen, [
    {
      type: "run-start",
      environment: "staging",
      total: 6,
      browsers: ["chrome"],
    },
  ]);
});

test("run-start names the workers only when there is more than one", () => {
  const seen: unknown[] = [];
  const reporter = new TestReporter({
    environment: "staging",
    browsers: ["chrome"],
    output: false,
    onEvent: (event) => event.type === "run-start" && seen.push(event),
  });
  reporter.onStart(6, 1);
  reporter.onStart(6, 3);
  assert.deepEqual(
    seen.map((e) => (e as { workers?: number }).workers),
    [undefined, 3],
  );
});

test("results from workers are listed in the order the run planned, whichever ends first", async () => {
  const a = testCase("a.spec.ts", "first");
  const b = testCase("a.spec.ts", "second");
  const c = testCase("a.spec.ts", "third");
  const events: string[] = [];
  const reporter = new TestReporter({
    environment: "staging",
    browsers: ["firefox"],
    output: false,
    onEvent: (event) =>
      events.push(event.type === "test-end" ? `end:${event.name}` : event.type),
  });
  reporter.onStart(3, 2);
  reporter.setOrder([
    { test: a, browser: "firefox" },
    { test: b, browser: "firefox" },
    { test: c, browser: "firefox" },
  ]);
  reporter.onTestStart(b, "firefox");
  reporter.onTestStart(a, "firefox");
  reporter.onRemoteEnd(b, "firefox", {
    name: "second",
    file: "a.spec.ts",
    browser: "firefox",
    status: "success",
    startTime: 999999,
    duration: 12,
    worker: 1,
  });
  reporter.onRemoteEnd(a, "firefox", {
    name: "first",
    file: "a.spec.ts",
    browser: "firefox",
    status: "failed",
    startTime: 999999,
    duration: 30,
    worker: 0,
    message: "boom",
    type: "error",
  } as never);
  reporter.onTestStart(c, "firefox");
  reporter.onRemoteEnd(c, "firefox", {
    name: "third",
    file: "a.spec.ts",
    browser: "firefox",
    status: "success",
    startTime: 1,
    duration: 5,
    worker: 1,
  });
  const summary = await reporter.onEnd();
  assert.deepEqual(
    summary.tests.map((t) => [t.name, t.status, "worker" in t && t.worker]),
    [
      ["first", "failed", 0],
      ["second", "success", 1],
      ["third", "success", 1],
    ],
  );
  assert.deepEqual(
    summary.tests.map((t) => ("duration" in t ? t.duration : undefined)),
    [30, 12, 5],
    "a worker's own duration is kept",
  );
  assert.ok(
    summary.tests.every((t) => t.startTime !== 999999 && t.startTime !== 1),
    "the start time is the one this process saw, not the worker's clock",
  );
  assert.deepEqual(events, [
    "run-start",
    "test-start",
    "test-start",
    "end:second",
    "end:first",
    "test-start",
    "end:third",
    "run-end",
  ]);
});

test("a skipped test reports a start and an end, is listed as skipped, and does not fail the run", async () => {
  const events: { type: string; result?: { status: string } }[] = [];
  const output = path.join(dir, `${Math.random()}.json`);
  const reporter = new TestReporter({
    environment: "staging",
    browsers: ["firefox"],
    output,
    onEvent: (event) => events.push(event),
  });
  const ran = testCase("a.spec.ts", "Checkout > pays");
  const skipped = testCase("a.spec.ts", "Checkout > old flow");
  reporter.onStart(2);
  reporter.onTestSkipped(skipped, "firefox", {
    annotation: "fixme",
    reason: "broken on staging",
  });
  reporter.onTestStart(ran, "firefox");
  reporter.onTestEnd(ran, "firefox");
  const summary = await reporter.onEnd();

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
  assert.equal(events[2]?.result?.status, "skipped");
  assert.equal(summary.status, "success");
  const written = JSON.parse(readFileSync(output, "utf8"));
  assert.deepEqual(
    written.tests.map((t: { name: string; status: string }) => [
      t.name,
      t.status,
    ]),
    [
      ["Checkout > old flow", "skipped"],
      ["Checkout > pays", "success"],
    ],
  );
  assert.equal(written.tests[0].annotation, "fixme");
  assert.equal(written.tests[0].reason, "broken on staging");
  assert.equal(written.tests[0].duration, 0);
});

test("a run with a failing test and a skipped one is failed", async () => {
  const bad = testCase("a.spec.ts", "bad");
  const skipped = testCase("a.spec.ts", "later");
  const summary = await report((reporter) => {
    reporter.onTestStart(bad, "firefox");
    reporter.onTestEnd(bad, "firefox", { message: "boom", type: "error" });
    reporter.onTestSkipped(skipped, "firefox", { annotation: "skip" });
  });
  assert.equal(summary.status, "failed");
  assert.equal(summary.tests.length, 2);
});

test("a secret in a skip reason is masked", async () => {
  registerSecret("TOKEN", "s3cret-value");
  const t = testCase("a.spec.ts", "needs token");
  const summary = await report((reporter) => {
    reporter.onTestSkipped(t, "firefox", {
      annotation: "skip",
      reason: "no s3cret-value here",
    });
  });
  assert.ok(summary.tests[0].reason.includes(MASK));
  assert.ok(!summary.tests[0].reason.includes("s3cret-value"));
});

test("a test that skips itself after it started does not start twice", async () => {
  const events: string[] = [];
  const reporter = new TestReporter({
    environment: "staging",
    browsers: ["firefox"],
    output: false,
    onEvent: (event) => events.push(event.type),
  });
  const t = testCase("a.spec.ts", "needs chrome");
  reporter.onStart(1);
  reporter.onTestStart(t, "firefox");
  reporter.onTestSkipped(t, "firefox", {
    annotation: "skip",
    reason: "needs Chrome",
  });
  assert.deepEqual(events, ["run-start", "test-start", "test-end"]);
});

test("a retried test starts once per attempt and ends once, with the retry fields in the report", async () => {
  const events: { type: string; retry?: number; result?: unknown }[] = [];
  const output = path.join(dir, `${Math.random()}.json`);
  const reporter = new TestReporter({
    environment: "staging",
    browsers: ["firefox"],
    output,
    onEvent: (event) => events.push(event),
  });
  const t = testCase("a.spec.ts", "pays");
  reporter.onStart(1);
  await runWithRetries(
    t,
    "firefox",
    2,
    undefined,
    async (sink, attempt) => {
      sink.onTestStart(t, "firefox");
      sink.onTestEnd(
        t,
        "firefox",
        attempt === 0
          ? { message: "first run failed", type: "error" }
          : undefined,
      );
    },
    reporter,
  );
  await reporter.onEnd();

  assert.deepEqual(
    events.map((e) => [e.type, e.retry]),
    [
      ["run-start", undefined],
      ["test-start", undefined],
      ["test-start", 1],
      ["test-end", undefined],
      ["run-end", undefined],
    ],
  );
  const written = JSON.parse(readFileSync(output, "utf8"));
  const [result] = written.tests;
  assert.equal(written.tests.length, 1, "one result per test");
  assert.equal(result.status, "success");
  assert.equal(result.flaky, true);
  assert.equal(result.retry, 1);
  assert.deepEqual(result.previousAttempts, [
    { message: "first run failed", type: "error" },
  ]);
  assert.equal(written.status, "success", "a flaky pass does not fail the run");
});

test("a secret in an earlier attempt's error is masked", async () => {
  registerSecret("TOKEN", "s3cret-value");
  const t = testCase("a.spec.ts", "pays");
  const summary = await report((reporter) => {
    reporter.onTestStart(t, "firefox");
    reporter.onTestEnd(t, "firefox", undefined, {
      retry: 1,
      flaky: true,
      previousAttempts: [{ message: "bad s3cret-value", type: "error" }],
    });
  });
  assert.ok(summary.tests[0].previousAttempts[0].message.includes(MASK));
  assert.ok(!JSON.stringify(summary).includes("s3cret-value"));
});

test("a result lists the test's inputs and outputs when there are any", async () => {
  const a = testCase("a.spec.ts", "with io");
  const b = testCase("b.spec.ts", "without");
  const summary = await report((reporter) => {
    reporter.onTestStart(a, "firefox");
    reporter.onTestStart(b, "firefox");
    reporter.onTestEnd(
      a,
      "firefox",
      { message: "boom", type: "error" },
      { inputs: { a: "1" }, outputs: {} },
    );
    reporter.onTestEnd(b, "firefox");
  });
  assert.deepEqual(summary.tests[0].inputs, { a: "1" });
  assert.deepEqual(summary.tests[0].outputs, {});
  assert.ok(
    !("inputs" in summary.tests[1]) && !("outputs" in summary.tests[1]),
  );
});
