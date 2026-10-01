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
  const reporter = new TestReporter({ environment: "staging", output });
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
    reporter.onTestStart(a);
    reporter.onTestStart(b);
    reporter.onTestEnd(a);
    reporter.onTestEnd(b, { message: "boom", type: "error" });
  });
  assert.deepEqual(
    summary.tests.map((t: { file: string; name: string; status: string }) => [t.file, t.name, t.status]),
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
    reporter.onTestStart(t);
    reporter.onTestEnd(
      t,
      {
        message: 'expected "4242424242424242"',
        type: "assertion",
        stack: "AssertionError: expected 4242424242424242\n    at x",
        expected: "4242424242424242",
        actual: "4242",
      },
      { logs: [{ level: "info", type: "console", text: "card 4242424242424242", timestamp: 1 }] },
    );
  });
  const [result] = summary.tests;
  assert.equal(result.message, `expected "${MASK}"`);
  assert.equal(result.expected, MASK);
  assert.equal(result.actual, "4242");
  assert.doesNotMatch(result.stack, /4242424242424242/);
  assert.equal(result.logs[0].text, `card ${MASK}`);
});
