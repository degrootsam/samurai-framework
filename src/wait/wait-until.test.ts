import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTimeout, waitUntil, WaitTimeoutError } from "./wait-until.js";

/** Probe returning the given values in order; the last one repeats */
function sequence<T>(...values: T[]) {
  let calls = 0;
  const probe = async () => values[Math.min(calls++, values.length - 1)]!;
  return { probe, calls: () => calls };
}

test("probes until isDone and resolves with that value", async () => {
  const { probe, calls } = sequence(1, 2, 3);
  assert.equal(await waitUntil(probe, (value) => value === 3, { timeout: 2000 }), 3);
  assert.equal(calls(), 3);
});

test("passes the previous value to isDone", async () => {
  const { probe } = sequence(1, 2, 2);
  const seen: Array<[number, number | undefined]> = [];
  await waitUntil(
    probe,
    (current, previous) => {
      seen.push([current, previous]);
      return current === previous;
    },
    { timeout: 2000 },
  );
  assert.deepEqual(seen, [
    [1, undefined],
    [2, 1],
    [2, 2],
  ]);
});

test("times out with the last value, ending at the deadline", async () => {
  const { probe, calls } = sequence("a", "b");
  const start = Date.now();
  await assert.rejects(waitUntil(probe, () => false, { timeout: 250 }), (err) => {
    assert.ok(err instanceof WaitTimeoutError);
    assert.equal(err.name, "WaitTimeoutError");
    assert.equal(err.timeout, 250);
    assert.equal(err.last, "b");
    return true;
  });
  const elapsed = Date.now() - start;
  // probes at ~0, ~100, ~200; the final sleep is clamped to the ~50ms left, and no probe starts after the deadline
  assert.ok(elapsed >= 250 && elapsed < 295, `elapsed ${elapsed}ms`);
  assert.equal(calls(), 3);
});

test("timeout 0 probes exactly once", async () => {
  const { probe, calls } = sequence(false);
  await assert.rejects(waitUntil(probe, (value) => value, { timeout: 0 }), WaitTimeoutError);
  assert.equal(calls(), 1);
});

test("timeout 0 resolves when the single probe is done", async () => {
  const { probe } = sequence(true);
  assert.equal(await waitUntil(probe, (value) => value, { timeout: 0 }), true);
});

test("probe errors are rethrown without retrying", async () => {
  let calls = 0;
  const probe = async () => {
    calls++;
    throw new Error("boom");
  };
  await assert.rejects(waitUntil(probe, () => true, { timeout: 2000 }), /boom/);
  assert.equal(calls, 1);
});

test("a probe that never settles stops at the deadline", async () => {
  const start = Date.now();
  await assert.rejects(
    waitUntil(() => new Promise<never>(() => {}), () => true, { timeout: 200 }),
    (err) => {
      assert.ok(err instanceof WaitTimeoutError);
      assert.equal(err.last, undefined);
      return true;
    },
  );
  assert.ok(Date.now() - start < 400);
});

test("a probe that hangs after earlier results reports the last completed value", async () => {
  let calls = 0;
  const probe = () => (calls++ === 0 ? Promise.resolve("first") : new Promise<string>(() => {}));
  await assert.rejects(waitUntil(probe, () => false, { timeout: 200 }), (err) => {
    assert.ok(err instanceof WaitTimeoutError);
    assert.equal(err.last, "first");
    return true;
  });
});

test("no timer outlives a resolved wait", async () => {
  const timers = () => process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
  const before = timers();
  await waitUntil(async () => true, (value) => value, { timeout: 10000 });
  assert.equal(timers(), before);
});

test("resolveTimeout prefers the per-call value", async () => {
  assert.equal(await resolveTimeout(1234), 1234);
  assert.equal(await resolveTimeout(0), 0);
});
