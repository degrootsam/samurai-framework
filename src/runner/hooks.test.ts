import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AssertionError } from "../assert/assertion-error.js";
import { HookError, runHook, runWithEachHooks } from "./hooks.js";
import { isSkipSignal, SkipSignal } from "./skip.js";
import { addHook, newSuite } from "./suite.js";
import type { TestFixtures } from "../types/test.js";
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

describe("runWithEachHooks", () => {
  const fixtures = {} as TestFixtures;
  const live = () => new AbortController().signal;

  /** A suite tree root > outer > inner with hooks that log their name, and a body that logs too */
  function setup(log: string[], failing: string[] = []) {
    const hook = (name: string) => () => {
      log.push(name);
      if (failing.includes(name)) throw new Error(`${name} failed`);
    };
    const root = newSuite();
    const outer = newSuite("outer", root);
    const inner = newSuite("inner", outer);
    addHook(root, "beforeEach", hook("root-before"));
    addHook(outer, "beforeEach", hook("outer-before"));
    addHook(inner, "beforeEach", hook("inner-before"));
    addHook(root, "afterEach", hook("root-after"));
    addHook(outer, "afterEach", hook("outer-after"));
    addHook(inner, "afterEach", hook("inner-after"));
    return inner;
  }

  it("runs beforeEach outermost first, the body, then afterEach innermost first", async () => {
    const log: string[] = [];
    await runWithEachHooks(setup(log), fixtures, live(), async () => {
      log.push("body");
    });
    assert.deepEqual(log, [
      "root-before",
      "outer-before",
      "inner-before",
      "body",
      "inner-after",
      "outer-after",
      "root-after",
    ]);
  });

  it("a failing beforeEach skips the body and the other beforeEach hooks, but not the afterEach hooks", async () => {
    const log: string[] = [];
    await assert.rejects(
      runWithEachHooks(
        setup(log, ["outer-before"]),
        fixtures,
        live(),
        async () => {
          log.push("body");
        },
      ),
      (error: Error) =>
        error.message === "beforeEach hook failed: outer-before failed",
    );
    assert.deepEqual(log, [
      "root-before",
      "outer-before",
      "inner-after",
      "outer-after",
      "root-after",
    ]);
  });

  it("runs afterEach after a failing body and reports the body's error", async () => {
    const log: string[] = [];
    await assert.rejects(
      runWithEachHooks(
        setup(log, ["inner-after"]),
        fixtures,
        live(),
        async () => {
          throw new Error("body failed");
        },
      ),
      { message: "body failed" },
    );
    assert.deepEqual(log.slice(-3), [
      "inner-after",
      "outer-after",
      "root-after",
    ]);
  });

  it("a failing afterEach fails a passing test, and the other afterEach hooks still run", async () => {
    const log: string[] = [];
    await assert.rejects(
      runWithEachHooks(
        setup(log, ["outer-after"]),
        fixtures,
        live(),
        async () => {},
      ),
      { message: "afterEach hook failed: outer-after failed" },
    );
    assert.deepEqual(log.slice(-3), [
      "inner-after",
      "outer-after",
      "root-after",
    ]);
  });

  it("does not run afterEach when the test was aborted (timeout, abort, closed browser)", async () => {
    const log: string[] = [];
    const controller = new AbortController();
    await runWithEachHooks(
      setup(log),
      fixtures,
      controller.signal,
      async () => {
        log.push("body");
        controller.abort();
      },
    );
    assert.deepEqual(log, [
      "root-before",
      "outer-before",
      "inner-before",
      "body",
    ]);
  });

  it("a skip from the body or a beforeEach still runs afterEach, and stays a skip", async () => {
    const log: string[] = [];
    await assert.rejects(
      runWithEachHooks(setup(log), fixtures, live(), async () => {
        throw new SkipSignal("skip", "no");
      }),
      (error) => isSkipSignal(error),
    );
    assert.equal(log[log.length - 1], "root-after");

    const skipInHook = newSuite();
    addHook(skipInHook, "beforeEach", () => {
      throw new SkipSignal("fixme");
    });
    await assert.rejects(
      runWithEachHooks(skipInHook, fixtures, live(), async () => {}),
      (error) => isSkipSignal(error),
    );
  });

  it("a failing afterEach turns a skip into a failure", async () => {
    await assert.rejects(
      runWithEachHooks(
        setup([], ["inner-after"]),
        fixtures,
        live(),
        async () => {
          throw new SkipSignal("skip");
        },
      ),
      /afterEach hook failed/,
    );
  });

  it("a test with no hooks just runs its body", async () => {
    let ran = false;
    await runWithEachHooks(newSuite(), fixtures, live(), async () => {
      ran = true;
    });
    assert.ok(ran);
  });
});
