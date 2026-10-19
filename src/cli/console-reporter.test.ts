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

test("a retried test says how it ended, and flaky passes are counted inside the passed", () => {
  const out = print(
    [
      {
        ...identity,
        name: "flaky",
        status: "success",
        duration: 2100,
        retry: 2,
        flaky: true,
        previousAttempts: [
          { message: "a", type: "error" },
          { message: "b", type: "error" },
        ],
      },
      {
        ...identity,
        name: "solid",
        status: "success",
        duration: 900,
      },
      {
        ...identity,
        name: "broken",
        status: "failed",
        duration: 1500,
        message: "boom",
        type: "error",
        retry: 1,
        previousAttempts: [{ message: "a", type: "error" }],
      },
    ],
    "failed",
  );
  assert.match(out, /✔ flaky \(2\.1s, passed on retry 2\)/);
  assert.match(out, /✔ solid \(0\.9s\)/);
  assert.match(out, /✖ broken \(1\.5s, failed after 1 retry\)/);
  assert.match(out, /1 failed, 2 passed \(1 flaky\)/);
});
