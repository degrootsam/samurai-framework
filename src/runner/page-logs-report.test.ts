import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PageError, type LogRecord } from "../browser/page-logs.js";
import { judgePageLogs, PageErrorsError, RouteErrorsError } from "./page-logs-report.js";

const entries: LogRecord[] = [
  { level: "info", type: "console", method: "log", text: "hello", timestamp: 1 },
  { level: "error", type: "javascript", text: "TypeError: x", timestamp: 2 },
];
const errors = [new PageError("TypeError: x", 2)];
const base = { entries, errors, dropped: 0, testFailed: false, allowPageErrors: false };

describe("judgePageLogs capture", () => {
  it("attaches the logs of a failed test by default", () => {
    const verdict = judgePageLogs({ ...base, config: undefined, testFailed: true });
    assert.deepEqual(verdict.logs, entries);
    assert.equal(verdict.error, undefined);
  });

  it("attaches nothing for a passing test by default", () => {
    assert.equal(judgePageLogs({ ...base, config: {} }).logs, undefined);
  });

  it("capture all attaches always, off never", () => {
    assert.deepEqual(judgePageLogs({ ...base, config: { capture: "all" } }).logs, entries);
    assert.equal(judgePageLogs({ ...base, config: { capture: "off" }, testFailed: true }).logs, undefined);
  });

  it("reports how many entries were dropped, only when some were", () => {
    assert.equal(judgePageLogs({ ...base, config: { capture: "all" }, dropped: 7 }).logsDropped, 7);
    assert.equal(judgePageLogs({ ...base, config: { capture: "all" } }).logsDropped, undefined);
  });

  it("attaches an empty list for a failed test that logged nothing, so the report says so", () => {
    assert.deepEqual(judgePageLogs({ ...base, config: {}, testFailed: true, entries: [], errors: [] }).logs, []);
  });
});

describe("judgePageLogs failOnPageError", () => {
  it("does not fail a test on page errors unless asked", () => {
    assert.equal(judgePageLogs({ ...base, config: {} }).error, undefined);
    assert.equal(judgePageLogs({ ...base, config: { failOnPageError: false } }).error, undefined);
  });

  it("fails a passing test that had a page error, and attaches the logs", () => {
    const verdict = judgePageLogs({ ...base, config: { failOnPageError: true } });
    assert.deepEqual(verdict.error, {
      message: "1 uncaught page error(s): TypeError: x",
      stack: verdict.error!.stack,
      type: "error",
    });
    assert.deepEqual(verdict.logs, entries, "a failed test gets its logs under the default capture");
  });

  it("names every error, the first in the headline", () => {
    const verdict = judgePageLogs({
      ...base,
      config: { failOnPageError: true },
      errors: [new PageError("Error: a", 1), new PageError("Error: b", 2), new PageError("Error: c", 3)],
    });
    assert.equal(verdict.error!.message, "3 uncaught page error(s): Error: a\nError: b\nError: c");
  });

  it("ignores errors matching a string (substring) or a RegExp", () => {
    const config = { failOnPageError: true, ignoreErrors: ["ResizeObserver", /^Script error/] };
    const verdict = judgePageLogs({
      ...base,
      config,
      errors: [new PageError("ResizeObserver loop limit exceeded", 1), new PageError("Script error.", 2)],
    });
    assert.equal(verdict.error, undefined);
    const partly = judgePageLogs({
      ...base,
      config,
      errors: [new PageError("ResizeObserver loop limit exceeded", 1), new PageError("Error: real", 2)],
    });
    assert.equal(partly.error!.message, "1 uncaught page error(s): Error: real");
  });

  it("allowPageErrors switches it off for that test", () => {
    const verdict = judgePageLogs({ ...base, config: { failOnPageError: true }, allowPageErrors: true });
    assert.equal(verdict.error, undefined);
  });

  it("a test that already failed keeps its own error, the logs are attached", () => {
    const verdict = judgePageLogs({ ...base, config: { failOnPageError: true }, testFailed: true });
    assert.equal(verdict.error, undefined);
    assert.deepEqual(verdict.logs, entries);
  });

  it("does not fail without page errors", () => {
    const verdict = judgePageLogs({ ...base, config: { failOnPageError: true }, errors: [] });
    assert.equal(verdict.error, undefined);
    assert.equal(verdict.logs, undefined);
  });

  it("with capture off a page-error failure still fails, without logs", () => {
    const verdict = judgePageLogs({ ...base, config: { failOnPageError: true, capture: "off" } });
    assert.ok(verdict.error);
    assert.equal(verdict.logs, undefined);
  });
});

describe("PageErrorsError", () => {
  it("lists the errors", () => {
    const error = new PageErrorsError([new PageError("Error: a", 1)]);
    assert.equal(error.name, "PageErrorsError");
    assert.equal(error.errors.length, 1);
    assert.equal(error.message, "1 uncaught page error(s): Error: a");
  });
});

describe("judgePageLogs route handler errors", () => {
  const routeErrors = [new Error("route handler for https://e.test/a threw: bug"), new Error("second")];

  it("fails a passing test whose route handler threw, whatever the logs config", () => {
    const verdict = judgePageLogs({ ...base, config: undefined, routeErrors, errors: [] });
    assert.equal(
      verdict.error!.message,
      "2 route handler error(s): route handler for https://e.test/a threw: bug\nsecond",
    );
    assert.deepEqual(verdict.logs, entries, "a failed test gets its logs");
  });

  it("does not replace the error of a test that already failed", () => {
    const verdict = judgePageLogs({ ...base, config: {}, routeErrors, testFailed: true });
    assert.equal(verdict.error, undefined);
  });

  it("takes precedence over page errors", () => {
    const verdict = judgePageLogs({ ...base, config: { failOnPageError: true }, routeErrors });
    assert.match(verdict.error!.message, /route handler error/);
  });

  it("no route errors, no failure", () => {
    assert.equal(judgePageLogs({ ...base, config: {}, routeErrors: [] }).error, undefined);
  });

  it("RouteErrorsError lists the errors", () => {
    const error = new RouteErrorsError(routeErrors);
    assert.equal(error.name, "RouteErrorsError");
    assert.equal(error.errors.length, 2);
  });
});
