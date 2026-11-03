import assert from "node:assert/strict";
import { test } from "node:test";
import { AssertionError } from "./assertion-error.js";
import { expect, takePendingAssertions } from "./expect.js";

/** A function that answers the given values in order, the last one repeating, and counts its calls */
function sequence<T>(...values: T[]) {
  let calls = 0;
  const fn = async () => values[Math.min(calls++, values.length - 1)]!;
  return { fn, calls: () => calls };
}

const FAST = [10];

test("toPass tries once by default and rethrows the error as it was", async () => {
  let calls = 0;
  await assert.rejects(
    expect(() => {
      calls++;
      expect(1).toBe(2);
    }).toPass(),
    (err) => err instanceof AssertionError && err.matcher === "toBe",
  );
  assert.equal(calls, 1);
});

test("toPass passes at once when the block does not throw", async () => {
  let calls = 0;
  await expect(() => {
    calls++;
  }).toPass();
  assert.equal(calls, 1);
});

test("toPass retries a block until it stops throwing", async () => {
  let calls = 0;
  await expect(async () => {
    calls++;
    if (calls < 4) throw new Error(`attempt ${calls}`);
  }).toPass({ timeout: 2000, intervals: FAST });
  assert.equal(calls, 4);
});

test("toPass fails at the timeout with the last failure", async () => {
  let calls = 0;
  const started = Date.now();
  await assert.rejects(
    expect(() => {
      calls++;
      throw new Error(`attempt ${calls}`);
    }).toPass({ timeout: 300, intervals: FAST }),
    (err) => {
      assert.match((err as Error).message, /^attempt \d+$/);
      assert.notEqual((err as Error).message, "attempt 1");
      return true;
    },
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 280 && elapsed < 1000, `elapsed ${elapsed}ms`);
  assert.ok(calls > 3);
});

test("toPass spaces its tries by the intervals, repeating the last", async () => {
  const times: number[] = [];
  await assert.rejects(
    expect(() => {
      times.push(Date.now());
      throw new Error("x");
    }).toPass({ timeout: 400, intervals: [50, 150] }),
  );
  const gaps = times.slice(1).map((time, i) => time - times[i]!);
  assert.ok(gaps[0]! >= 45 && gaps[0]! < 120, `gaps ${gaps}`);
  assert.ok(gaps[1]! >= 140, `gaps ${gaps}`);
});

test("toPass wraps a thrown non-error", async () => {
  await assert.rejects(
    expect(() => {
      throw "plain";
    }).toPass(),
    (err) => err instanceof Error && err.message === "plain",
  );
});

test("not.toPass waits until the block throws", async () => {
  let calls = 0;
  await expect(() => {
    if (++calls > 2) throw new Error("now");
  }).not.toPass({ timeout: 2000, intervals: FAST });
  await assert.rejects(
    expect(() => {}).not.toPass({ timeout: 100, intervals: FAST }),
    (err) => err instanceof AssertionError && err.matcher === "not.toPass",
  );
});

test("toPass needs a function, and is tracked until awaited", async () => {
  assert.throws(() => expect(1).toPass(), TypeError);
  takePendingAssertions();
  const pending = expect(() => {}).toPass();
  const failing = expect(() => {
    throw new Error("x");
  }).toPass();
  assert.deepEqual(takePendingAssertions(), [
    "expect(value).toPass()",
    "expect(value).toPass()",
  ]);
  await pending;
  await assert.rejects(failing);
});

test("poll waits until the matcher passes", async () => {
  const { fn, calls } = sequence(1, 2, 3);
  await expect.poll(fn, { timeout: 2000, intervals: FAST }).toBe(3);
  assert.equal(calls(), 3);
});

test("poll works with every value matcher, asymmetric matchers and .not", async () => {
  const value = () => ({ id: 7, tags: ["a", "b"] });
  await expect
    .poll(value)
    .toEqual({ id: expect.any(Number), tags: ["a", "b"] });
  await expect.poll(value).toMatchObject({ id: 7 });
  await expect.poll(() => [1, 2]).toHaveLength(2);
  await expect.poll(() => null).toBeNull();
  await expect.poll(() => 0.1 + 0.2).toBeCloseTo(0.3);
  await expect.poll(() => "abc").not.toContain("z");
  await expect
    .poll(sequence(1, 1, 2).fn, { intervals: FAST, timeout: 2000 })
    .not.toBe(1);
});

test("poll fails at the timeout with the last received value", async () => {
  const { fn } = sequence(1, 2);
  const started = Date.now();
  await assert.rejects(
    expect.poll(fn, { timeout: 300, intervals: FAST }).toBe(3),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "toBe");
      assert.equal(err.expected, 3);
      assert.equal(err.actual, 2);
      assert.match(err.message, /^expect\.poll\(\)\.toBe/);
      return true;
    },
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 280 && elapsed < 1000, `elapsed ${elapsed}ms`);
});

test("poll with .not names the failure not.<matcher>", async () => {
  await assert.rejects(
    expect.poll(() => 1, { timeout: 100, intervals: FAST }).not.toBe(1),
    (err) => err instanceof AssertionError && err.matcher === "not.toBe",
  );
});

test("poll timeout 0 reads once", async () => {
  const { fn, calls } = sequence(1, 2);
  await assert.rejects(expect.poll(fn, { timeout: 0 }).toBe(2), AssertionError);
  assert.equal(calls(), 1);
});

test("poll shows the message option as the first line", async () => {
  await assert.rejects(
    expect.poll(() => 1, { timeout: 0, message: "order status" }).toBe(2),
    (err) => (err as Error).message.startsWith("order status\n"),
  );
});

test("poll keeps polling when the function throws, and reports it at the end", async () => {
  let calls = 0;
  await expect
    .poll(
      () => {
        if (++calls < 3) throw new Error("not up yet");
        return "up";
      },
      { timeout: 2000, intervals: FAST },
    )
    .toBe("up");
  await assert.rejects(
    expect
      .poll(
        () => {
          throw new Error("down");
        },
        { timeout: 100, intervals: FAST },
      )
      .toBe(1),
    /expect\.poll\(\)\.toBe: the function threw: down/,
  );
});

test("poll does not retry a matcher misuse", async () => {
  const { fn, calls } = sequence(5);
  await assert.rejects(
    expect.poll(fn, { timeout: 2000, intervals: FAST }).toHaveLength(1),
    TypeError,
  );
  assert.equal(calls(), 1);
});

test("poll stops at the timeout when the function never answers", async () => {
  await assert.rejects(
    expect.poll(() => new Promise<number>(() => {}), { timeout: 150 }).toBe(1),
    /expect\.poll\(\)\.toBe: timed out after 150ms/,
  );
});

test("poll is tracked until awaited, and the object is not thenable", async () => {
  takePendingAssertions();
  const poll = expect.poll(() => 1, { timeout: 0 });
  assert.equal((poll as unknown as { then?: unknown }).then, undefined);
  const pending = poll.toBe(1);
  assert.deepEqual(takePendingAssertions(), ["expect.poll().toBe()"]);
  await pending;
});
