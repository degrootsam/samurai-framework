import assert from "node:assert/strict";
import { test } from "node:test";
import { BiDiError } from "../transport/bidi-error.js";
import {
  abandonLaunch,
  BrowserStartTimeoutError,
  startSession,
} from "./session.js";

test("a failed launch stops the connection and the browser it started", () => {
  const calls: string[] = [];
  abandonLaunch(
    { kill: () => calls.push("browser") > 0 },
    { kill: () => void calls.push("connector") },
  );
  assert.deepEqual(calls, ["connector", "browser"]);
});

test("a launch that failed before connecting still stops the browser", () => {
  const calls: string[] = [];
  abandonLaunch({ kill: () => calls.push("browser") > 0 }, undefined);
  assert.deepEqual(calls, ["browser"]);
});

test("session.new waits at least two minutes, longer when the command timeout is longer", async () => {
  const timeouts: (number | undefined)[] = [];
  const connector = {
    send: async (_m: string, _p: unknown, options?: { timeout?: number }) => {
      timeouts.push(options?.timeout);
      return {};
    },
  };
  await startSession(connector as never, "Firefox 158.0", undefined);
  await startSession(connector as never, "Firefox 158.0", 30_000);
  await startSession(connector as never, "Firefox 158.0", 300_000);
  assert.deepEqual(timeouts, [120_000, 120_000, 300_000]);
});

test("a session.new that times out says the browser did not finish starting", async () => {
  const connector = {
    send: async () => {
      throw new BiDiError("session.new", "timeout", "no reply within 120000ms");
    },
  };
  await assert.rejects(
    startSession(connector as never, "Firefox 158.0", undefined),
    (e: unknown) =>
      e instanceof BrowserStartTimeoutError &&
      e.message ===
        "Firefox 158.0 did not finish starting within 120s. The first start after an install can be slow; run again.",
  );
});

test("a session.new that fails otherwise keeps its error", async () => {
  const failure = new BiDiError("session.new", "session not created", "busy");
  const connector = {
    send: async () => {
      throw failure;
    },
  };
  await assert.rejects(
    startSession(connector as never, "Firefox", 1000),
    failure,
  );
});
