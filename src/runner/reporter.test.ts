import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import TestReporter from "./reporter.js";
import { runWithRetries } from "./retry.js";
import { MASK, registerSecret } from "../config/mask.js";
import {
  dir,
  installReporterHooks,
  report,
  testCase,
} from "../testing/reporter-setup.js";

installReporterHooks();

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

test("the same test for two groups gives two results, each with its group", async () => {
  const t = testCase("a.spec.ts", "pays");
  const phone = { ...t, group: "phone" };
  const desktop = { ...t, group: "desktop" };
  const output = path.join(dir, `${Math.random()}.json`);
  const events: { type: string; group?: string }[] = [];
  const reporter = new TestReporter({
    environment: "staging",
    browsers: ["firefox"],
    output,
    onEvent: (event) =>
      events.push({
        type: event.type,
        ...("group" in event && { group: event.group }),
      }),
  });
  reporter.onStart(2);
  reporter.onTestStart(phone, "firefox");
  reporter.onTestStart(desktop, "firefox");
  reporter.onTestEnd(desktop, "firefox");
  reporter.onTestEnd(phone, "firefox", { message: "boom", type: "error" });
  await reporter.onEnd();
  const summary = JSON.parse(readFileSync(output, "utf8"));
  assert.deepEqual(
    summary.tests.map((r: { group: string; status: string }) => [
      r.group,
      r.status,
    ]),
    [
      ["phone", "failed"],
      ["desktop", "success"],
    ],
  );
  assert.deepEqual(
    events.filter((e) => e.type.startsWith("test-")).map((e) => e.group),
    ["phone", "desktop", "desktop", "phone"],
  );
});

test("a result without a group has no group key", async () => {
  const t = testCase("a.spec.ts", "pays");
  const summary = await report((reporter) => {
    reporter.onTestStart(t, "firefox");
    reporter.onTestEnd(t, "firefox");
  });
  assert.ok(!("group" in summary.tests[0]));
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
