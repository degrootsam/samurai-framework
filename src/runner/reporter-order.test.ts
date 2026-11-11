import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import TestReporter from "./reporter.js";
import { MASK, registerSecret } from "../config/mask.js";
import {
  dir,
  installReporterHooks,
  report,
  testCase,
} from "../testing/reporter-setup.js";

installReporterHooks();

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
