import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TestError } from "../types/test.js";
import type { TestSink } from "./reporter.js";
import { runWithRetries, type Attempt } from "./retry.js";
import { newSuite } from "./suite.js";

const test = {
  name: "pays",
  file: "/p/a.spec.ts",
  titlePath: ["pays"],
  suite: newSuite(),
  function: async () => {},
};
const boom = (message: string): TestError => ({ message, type: "error" });

/** A sink that logs what reaches it */
function recorder() {
  const log: unknown[][] = [];
  const sink: TestSink = {
    onTestStart: (_t, browser, retry) =>
      void log.push(["start", browser, retry]),
    onTestEnd: (_t, _b, error, extras) =>
      void log.push(["end", error?.message, extras]),
    onTestSkipped: (_t, _b, skip) => void log.push(["skipped", skip]),
  };
  return { sink, log };
}

/** Attempts that end the way the list says: an error message, or undefined for a pass */
function attempts(outcomes: (string | undefined)[]): {
  run: Attempt;
  ran: number[];
} {
  const ran: number[] = [];
  const run: Attempt = async (sink, n) => {
    ran.push(n);
    sink.onTestStart(test, "firefox");
    const message = outcomes[n];
    sink.onTestEnd(
      test,
      "firefox",
      message === undefined ? undefined : boom(message),
      {
        screenshots: [{ name: `shot${n}`, path: `p${n}.png` }],
      },
    );
  };
  return { run, ran };
}

describe("runWithRetries", () => {
  it("without retries the attempt reports straight to the sink, as before", async () => {
    const { sink, log } = recorder();
    const { run, ran } = attempts(["x"]);
    await runWithRetries(test, "firefox", 0, undefined, run, sink);
    assert.deepEqual(ran, [0]);
    assert.deepEqual(
      log.map((l) => l[0]),
      ["start", "end"],
    );
    assert.equal(log[1]?.[1], "x");
  });

  it("a test that passes the first time reports once, with nothing about retries", async () => {
    const { sink, log } = recorder();
    const { run, ran } = attempts([undefined]);
    await runWithRetries(test, "firefox", 2, undefined, run, sink);
    assert.deepEqual(ran, [0]);
    assert.deepEqual(log, [
      ["start", "firefox", undefined],
      ["end", undefined, { screenshots: [{ name: "shot0", path: "p0.png" }] }],
    ]);
  });

  it("a flaky test starts per attempt and ends once, as a pass on the retry, with the error before it", async () => {
    const { sink, log } = recorder();
    const { run, ran } = attempts(["first", undefined]);
    await runWithRetries(test, "firefox", 2, undefined, run, sink);
    assert.deepEqual(ran, [0, 1]);
    assert.deepEqual(
      log.map((l) => l[0]),
      ["start", "start", "end"],
    );
    assert.deepEqual(
      log.filter((l) => l[0] === "start").map((l) => l[2]),
      [undefined, 1],
    );
    assert.equal(log[2]?.[1], undefined, "the end is the pass");
    assert.deepEqual(log[2]?.[2], {
      screenshots: [{ name: "shot1", path: "p1.png" }],
      retry: 1,
      previousAttempts: [boom("first")],
      flaky: true,
    });
  });

  it("a test that fails every attempt ends failed with the last error, the earlier ones, and the last attempt's number", async () => {
    const { sink, log } = recorder();
    const { run, ran } = attempts(["a", "b", "c"]);
    await runWithRetries(test, "firefox", 2, undefined, run, sink);
    assert.deepEqual(ran, [0, 1, 2]);
    assert.equal(log.filter((l) => l[0] === "end").length, 1);
    const end = log[log.length - 1]!;
    assert.equal(end[1], "c");
    assert.deepEqual(end[2], {
      screenshots: [{ name: "shot2", path: "p2.png" }],
      retry: 2,
      previousAttempts: [boom("a"), boom("b")],
    });
  });

  it("stops at the first pass", async () => {
    const { sink } = recorder();
    const { run, ran } = attempts(["a", undefined, "never"]);
    await runWithRetries(test, "firefox", 5, undefined, run, sink);
    assert.deepEqual(ran, [0, 1]);
  });

  it("does not run again once the run is aborted, or when the failure is the abort", async () => {
    const controller = new AbortController();
    const first = recorder();
    const { run, ran } = attempts(["boom", undefined]);
    controller.abort();
    await runWithRetries(
      test,
      "firefox",
      3,
      controller.signal,
      run,
      first.sink,
    );
    assert.deepEqual(ran, [0]);
    assert.equal(first.log[first.log.length - 1]?.[1], "boom");

    const second = recorder();
    const aborted = attempts(["Run aborted", undefined]);
    await runWithRetries(
      test,
      "firefox",
      3,
      undefined,
      aborted.run,
      second.sink,
    );
    assert.deepEqual(aborted.ran, [0]);
  });

  it("a test that skips itself ends there, and is not run again", async () => {
    const { sink, log } = recorder();
    const ran: number[] = [];
    const run: Attempt = async (attemptSink, n) => {
      ran.push(n);
      attemptSink.onTestStart(test, "firefox");
      attemptSink.onTestSkipped(test, "firefox", {
        annotation: "skip",
        reason: "no",
      });
    };
    await runWithRetries(test, "firefox", 3, undefined, run, sink);
    assert.deepEqual(ran, [0]);
    assert.deepEqual(
      log.map((l) => l[0]),
      ["start", "skipped"],
    );
  });
});
