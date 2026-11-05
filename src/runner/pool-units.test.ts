import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TestResult } from "../types/test.js";
import { errorOf, serialSkipped, UnitState } from "./pool-units.js";
import { SERIAL_SKIP_REASON } from "./serial.js";
import type { WorkItem } from "./worker-protocol.js";

const entry = (testName: string) => ({
  item: { index: 0, file: "/a", testName, browser: "firefox" } as WorkItem,
});
const ok = (name: string): TestResult =>
  ({ name, status: "success", duration: 1 }) as TestResult;
const bad = (name: string): TestResult =>
  ({
    name,
    status: "failed",
    type: "assertion",
    message: "boom",
    duration: 1,
  }) as TestResult;

describe("UnitState", () => {
  it("releases the results of a first attempt as they are", () => {
    const state = new UnitState<ReturnType<typeof entry>>(undefined);
    const a = entry("a");
    state.hold(a, ok("a"));
    assert.deepEqual(state.release(), [{ entry: a, result: ok("a") }]);
    assert.deepEqual(state.release(), []);
  });

  it("restarts with the entries held so far and names the attempt afterwards", () => {
    const state = new UnitState<ReturnType<typeof entry>>(undefined);
    const [a, b] = [entry("a"), entry("b")];
    state.hold(a!, ok("a"));
    state.hold(b!, bad("b"));
    assert.deepEqual(state.restart(b!, bad("b")), [a, b]);
    state.hold(a!, ok("a"));
    state.hold(b!, ok("b"));
    const [first, second] = state.release();
    assert.deepEqual(first?.result, {
      ...ok("a"),
      retry: 1,
      previousAttempts: [],
    });
    assert.equal(second?.result.status, "success");
    assert.equal((second?.result as { flaky?: boolean }).flaky, true);
    assert.equal(
      (second?.result as { previousAttempts?: unknown[] }).previousAttempts
        ?.length,
      1,
    );
  });
});

describe("serialSkipped and errorOf", () => {
  it("skips with the serial reason", () => {
    const result = serialSkipped(entry("x").item);
    assert.equal(result.status, "skipped");
    assert.equal((result as { reason?: string }).reason, SERIAL_SKIP_REASON);
  });

  it("keeps the fields of a test error", () => {
    assert.deepEqual(errorOf(bad("x")), { message: "boom", type: "assertion" });
  });
});
