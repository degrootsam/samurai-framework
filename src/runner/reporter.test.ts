import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import TestReporter from "./reporter.js";
import { MASK, registerSecret, resetSecrets } from "../config/mask.js";
import type { RegisteredTestCase } from "../types/test.js";

const dir = mkdtempSync(path.join(tmpdir(), "samurai-reporter-"));
after(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => resetSecrets());

function testCase(file: string, name: string): RegisteredTestCase {
  return { file, name, titlePath: name.split(" > "), function: async () => {} };
}

async function report(run: (reporter: TestReporter) => void) {
  const output = path.join(dir, `${Math.random()}.json`);
  const reporter = new TestReporter({
    environment: "staging",
    browsers: ["firefox"],
    output,
  });
  reporter.onStart();
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
