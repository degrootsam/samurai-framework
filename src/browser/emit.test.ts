import assert from "node:assert/strict";
import EventEmitter from "node:events";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import logger from "../logger/index.js";
import { emitSafely } from "./emit.js";

let error: ReturnType<typeof mock.method>;
beforeEach(() => {
  error = mock.method(logger, "error", () => logger);
});
afterEach(() => mock.restoreAll());

describe("emitSafely", () => {
  it("calls every listener in order with the arguments", () => {
    const emitter = new EventEmitter();
    const seen: string[] = [];
    emitter.on("x", (a: string, b: string) => seen.push(`one ${a}${b}`));
    emitter.on("x", (a: string) => seen.push(`two ${a}`));
    emitSafely(emitter, "x", ["a", "b"]);
    assert.deepEqual(seen, ["one ab", "two a"]);
  });

  it("logs a listener that throws and still calls the next one", () => {
    const emitter = new EventEmitter();
    const seen: string[] = [];
    emitter.on("x", () => {
      throw new Error("boom");
    });
    emitter.on("x", () => seen.push("second"));
    emitSafely(emitter, "x", [], "thing");
    assert.deepEqual(seen, ["second"]);
    assert.equal(error.mock.callCount(), 1);
    assert.deepEqual(error.mock.calls[0]!.arguments.slice(0, 2), [
      "A %s listener threw",
      "thing",
    ]);
  });

  it("calls a once listener once, and the label defaults to the event", () => {
    const emitter = new EventEmitter();
    let calls = 0;
    emitter.once("x", () => {
      calls++;
      throw new Error("boom");
    });
    emitSafely(emitter, "x", []);
    emitSafely(emitter, "x", []);
    assert.equal(calls, 1);
    assert.equal(error.mock.calls[0]!.arguments[1], "x");
  });
});
