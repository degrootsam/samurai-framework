import assert from "node:assert/strict";
import { test } from "node:test";
import type { RegisteredTestCase } from "../types/test.js";
import type { PreparedRun } from "./prepare-run.js";
import type { TestSink } from "./reporter.js";
import { runOneTest } from "./run-test.js";
import { newSuite } from "./suite.js";

test("a test marked skip is reported skipped by runOneTest itself, without a browser", async () => {
  const log: string[] = [];
  const sink: TestSink = {
    onTestStart: () => void log.push("start"),
    onTestEnd: () => void log.push("end"),
    onTestSkipped: (_t, _b, skip) =>
      void log.push(
        `skipped ${skip.annotation}${skip.reason ? `: ${skip.reason}` : ""}`,
      ),
  };
  const marked = (
    modifier: "skip" | "fixme",
    reason?: string,
  ): RegisteredTestCase => ({
    name: "later",
    file: "/p/a.spec.ts",
    titlePath: ["later"],
    suite: newSuite(),
    function: async () => {
      throw new Error("must not run");
    },
    modifier,
    ...(reason !== undefined && { reason }),
  });
  // The run is never read: nothing starts
  const run = {} as PreparedRun;
  await runOneTest(marked("skip"), "firefox", run, {}, "/p", sink);
  await runOneTest(
    marked("fixme", "flaky on CI"),
    "firefox",
    run,
    {},
    "/p",
    sink,
  );
  assert.deepEqual(log, ["skipped skip", "skipped fixme: flaky on CI"]);
});
