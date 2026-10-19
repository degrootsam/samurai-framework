import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AssertionError } from "../assert/assertion-error.js";
import { HookError, runHook } from "./hooks.js";
import { toTestError } from "./test-error.js";

describe("runHook", () => {
  it("passes the fixtures and waits for an async hook", async () => {
    const seen: string[] = [];
    await runHook(
      "beforeEach",
      async (f: { name: string }) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(f.name);
      },
      { name: "fixtures" },
    );
    assert.deepEqual(seen, ["fixtures"]);
  });

  it("turns a throw, sync or async, into a labelled HookError", async () => {
    await assert.rejects(
      runHook(
        "afterAll",
        () => {
          throw new Error("boom");
        },
        {},
      ),
      (error: HookError) =>
        error instanceof HookError &&
        error.kind === "afterAll" &&
        error.message === "afterAll hook failed: boom",
    );
    await assert.rejects(
      runHook(
        "beforeAll",
        async () => {
          throw new Error("late");
        },
        {},
      ),
      /beforeAll hook failed: late/,
    );
  });

  it("fails a hook that outlives its limit", async () => {
    await assert.rejects(
      runHook("beforeAll", () => new Promise<void>(() => {}), {}, 20),
      /beforeAll hook failed: timed out after 0.02 seconds/,
    );
  });

  it("does not time a hook that has no limit", async () => {
    await runHook(
      "beforeEach",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      },
      {},
    );
  });
});

describe("toTestError", () => {
  it("keeps the kind of error a hook threw, under the hook's message", () => {
    const plain = toTestError(new HookError("beforeEach", new Error("x")));
    assert.equal(plain.type, "error");
    assert.equal(plain.message, "beforeEach hook failed: x");

    const assertion = toTestError(
      new HookError(
        "afterEach",
        new AssertionError({ matcher: "toBe", expected: 2, actual: 1 }),
      ),
    );
    assert.equal(assertion.type, "assertion");
    assert.match(assertion.message, /^afterEach hook failed: /);
  });
});
