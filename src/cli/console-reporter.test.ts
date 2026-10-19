import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestResult, TestSummary } from "../runner/run.js";
import { ConsoleReporter } from "./console-reporter.js";

const identity = {
  file: "/work/a.spec.ts",
  browser: "firefox" as const,
  startTime: 0,
};

function print(results: TestResult[], status: TestSummary["status"]) {
  let out = "";
  const reporter = new ConsoleReporter({
    write: (text) => (out += text),
    color: false,
  });
  reporter.handle({
    type: "run-start",
    environment: "staging",
    total: results.length,
    browsers: ["firefox"],
  });
  for (const result of results)
    reporter.handle({
      type: "test-end",
      name: "name" in result ? result.name : "",
      file: identity.file,
      browser: "firefox",
      result,
    });
  reporter.handle({
    type: "run-end",
    summary: {
      status,
      duration: 1000,
      startTime: 0,
      environment: "staging",
      browsers: ["firefox"],
      tests: results,
    } as TestSummary,
  });
  return out;
}

test("a skipped test is a dash with its reason, and is counted apart from passed and failed", () => {
  const out = print(
    [
      { ...identity, name: "pays", status: "success", duration: 1200 },
      {
        ...identity,
        name: "old flow",
        status: "skipped",
        duration: 0,
        annotation: "skip",
        reason: "needs Chrome",
      },
      {
        ...identity,
        name: "broken",
        status: "skipped",
        duration: 0,
        annotation: "fixme",
      },
    ],
    "success",
  );
  assert.match(out, /✔ pays/);
  assert.match(out, /- old flow \(skipped: needs Chrome\)/);
  assert.match(out, /- broken \(fixme\)/);
  assert.match(out, /1 passed, 2 skipped/);
  assert.doesNotMatch(out, /failed/);
});

test("skipped tests are not listed among the failures", () => {
  const out = print(
    [
      {
        ...identity,
        name: "bad",
        status: "failed",
        duration: 5,
        message: "boom",
        type: "error",
      },
      {
        ...identity,
        name: "later",
        status: "skipped",
        duration: 0,
        annotation: "skip",
      },
    ],
    "failed",
  );
  assert.match(out, /1 failed, 0 passed, 1 skipped/);
  assert.match(out, /boom/);
});
