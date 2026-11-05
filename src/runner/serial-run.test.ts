import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RegisteredTestCase, TestError } from "../types/test.js";
import type { TestSink } from "./reporter.js";
import { serialBlockRun } from "./serial-run.js";
import { SERIAL_SKIP_REASON } from "./serial.js";
import { newSuite } from "./suite.js";

const make = (name: string, modifier?: "skip"): RegisteredTestCase =>
  ({
    name,
    file: "/a.spec.ts",
    titlePath: [name],
    suite: newSuite(),
    ...(modifier && { modifier }),
  }) as unknown as RegisteredTestCase;

const boom: TestError = { message: "boom", type: "error" };

/** Runs a block whose tests pass or fail as `plan` says per attempt: `plan[name][attempt]` is true when it fails */
async function run(
  names: string[],
  plan: Record<string, boolean[]>,
  retries = 0,
  statics: string[] = [],
) {
  const log: string[] = [];
  const tests = names.map((n) =>
    make(n, statics.includes(n) ? "skip" : undefined),
  );
  let restarts = 0;
  const sink: TestSink = {
    onTestStart: (t, _b, retry) =>
      log.push(`start ${t.name}${retry ? ` #${retry}` : ""}`),
    onTestEnd: (t, _b, error, extras) =>
      log.push(
        `end ${t.name} ${error ? "failed" : "ok"}${extras?.retry ? ` retry=${extras.retry}` : ""}${extras?.flaky ? " flaky" : ""}${extras?.previousAttempts ? ` prev=${extras.previousAttempts.length}` : ""}`,
      ),
    onTestSkipped: (t, _b, skip) =>
      log.push(`skip ${t.name} ${skip.reason ?? skip.annotation}`),
  };
  await serialBlockRun({
    tests,
    browser: "firefox",
    retries,
    signal: undefined,
    sink,
    restart: async () => void restarts++,
    runTest: async (test, attemptSink, attempt) => {
      attemptSink.onTestStart(test, "firefox");
      log.push(`ran ${test.name}@${attempt}`);
      attemptSink.onTestEnd(
        test,
        "firefox",
        plan[test.name]?.[attempt] ? boom : undefined,
      );
    },
  });
  return { log, restarts };
}

describe("serialBlockRun", () => {
  it("runs the tests in order and reports each as it ends", async () => {
    const { log } = await run(["a", "b"], {});
    assert.deepEqual(log, [
      "start a",
      "ran a@0",
      "end a ok",
      "start b",
      "ran b@0",
      "end b ok",
    ]);
  });

  it("skips the rest after a failure, with the reason", async () => {
    const { log } = await run(["a", "b", "c"], { b: [true] });
    assert.deepEqual(log.slice(-3), [
      "ran b@0",
      "end b failed",
      `skip c ${SERIAL_SKIP_REASON}`,
    ]);
    assert.ok(!log.some((line) => line.startsWith("ran c")));
  });

  it("starts over from the first test after a failure, when there are retries", async () => {
    const { log, restarts } = await run(
      ["a", "b", "c"],
      { b: [true, false] },
      1,
    );
    assert.equal(restarts, 1);
    assert.deepEqual(
      log.filter((l) => l.startsWith("ran")),
      ["ran a@0", "ran b@0", "ran a@1", "ran b@1", "ran c@1"],
    );
    assert.deepEqual(
      log.filter((l) => l.startsWith("end")),
      [
        "end a ok retry=1 prev=0",
        "end b ok retry=1 flaky prev=1",
        "end c ok retry=1 prev=0",
      ],
    );
  });

  it("reports the failure and skips the rest once the retries are used up", async () => {
    const { log, restarts } = await run(
      ["a", "b", "c"],
      { a: [true, true] },
      1,
    );
    assert.equal(restarts, 1);
    assert.deepEqual(
      log.filter((l) => l.startsWith("end")),
      ["end a failed retry=1 prev=1"],
    );
    assert.ok(log.includes(`skip b ${SERIAL_SKIP_REASON}`));
    assert.ok(log.includes(`skip c ${SERIAL_SKIP_REASON}`));
  });

  it("reports a statically skipped test as skipped and does not let it break the block", async () => {
    const { log } = await run(["a", "b", "c"], {}, 0, ["b"]);
    assert.ok(log.includes("skip b skip"));
    assert.ok(log.includes("end c ok"));
  });
});
