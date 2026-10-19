import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Lazy } from "./lazy.js";

describe("Lazy", () => {
  it("starts once and shares the promise between callers", async () => {
    const lazy = new Lazy<number>();
    let starts = 0;
    const factory = async () => ++starts;
    const [a, b] = await Promise.all([lazy.get(factory), lazy.get(factory)]);
    assert.deepEqual([a, b, starts], [1, 1, 1]);
    assert.equal(await lazy.get(factory), 1);
    assert.equal(lazy.started, true);
  });

  it("peek has the value once the start finished, and not before or after reset", async () => {
    const lazy = new Lazy<string>();
    assert.equal(lazy.peek(), undefined);
    let release!: (value: string) => void;
    const pending = lazy.get(
      () => new Promise((resolve) => (release = resolve)),
    );
    assert.equal(lazy.peek(), undefined, "still starting");
    release("ready");
    await pending;
    assert.equal(lazy.peek(), "ready");
    lazy.reset();
    assert.equal(lazy.peek(), undefined);
    assert.equal(lazy.started, false);
  });

  it("forgets a failed start, so the next call tries again", async () => {
    const lazy = new Lazy<number>();
    await assert.rejects(
      lazy.get(async () => Promise.reject(new Error("no"))),
      /no/,
    );
    assert.equal(lazy.started, false);
    assert.equal(await lazy.get(async () => 2), 2);
  });

  it("keeps a failure the caller says to keep", async () => {
    const lazy = new Lazy<number>();
    const keep = (err: unknown) => err instanceof RangeError;
    await assert.rejects(
      lazy.get(async () => Promise.reject(new RangeError("off")), keep),
      /off/,
    );
    assert.equal(lazy.started, true);
    await assert.rejects(
      lazy.get(async () => 3, keep),
      /off/,
      "the same rejection",
    );
  });

  it("a factory that throws before it returns is a rejection too", async () => {
    const lazy = new Lazy<number>();
    await assert.rejects(
      lazy.get(() => {
        throw new Error("sync");
      }),
      /sync/,
    );
    assert.equal(lazy.started, false);
  });

  it("take hands back the pending promise and forgets it; a late failure does not touch a newer start", async () => {
    const lazy = new Lazy<number>();
    let fail!: (err: Error) => void;
    void lazy
      .get(() => new Promise((_, reject) => (fail = reject)))
      .catch(() => undefined);
    const taken = lazy.take();
    assert.ok(taken);
    assert.equal(lazy.started, false);
    assert.equal(await lazy.get(async () => 9), 9);
    fail(new Error("late"));
    await assert.rejects(taken, /late/);
    assert.equal(lazy.started, true, "the newer start is still there");
    assert.equal(lazy.peek(), 9);
    assert.equal(lazy.take() !== undefined, true);
    assert.equal(new Lazy().take(), undefined);
  });
});
