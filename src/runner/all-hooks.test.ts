import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AllHook,
  AllHookFixtures,
  RegisteredTestCase,
  Suite,
} from "../types/test.js";
import { AllHooks } from "./all-hooks.js";
import { HookError } from "./hooks.js";
import { newSuite } from "./suite.js";

const testIn = (suite: Suite, name = "t"): RegisteredTestCase => ({
  name,
  file: "/p/a.spec.ts",
  titlePath: [name],
  suite,
  function: async () => {},
});

function setup(timeout = 1000) {
  const log: string[] = [];
  const fixturesSeen: AllHookFixtures[] = [];
  const hook =
    (name: string, fail?: string): AllHook =>
    (fixtures) => {
      log.push(name);
      fixturesSeen.push(fixtures);
      if (fail) throw new Error(fail);
    };
  const all = new AllHooks({
    timeout,
    fixtures: (browser): AllHookFixtures => ({
      browserName: browser,
      workerIndex: 3,
      env: {},
      secrets: {},
    }),
  });
  return { all, log, hook, fixturesSeen };
}

describe("ensure", () => {
  it("runs beforeAll outer to inner, once per scope and browser", async () => {
    const { all, log, hook } = setup();
    const outer = newSuite("A");
    const inner = newSuite("B", outer);
    outer.beforeAll = [hook("outer1"), hook("outer2")];
    inner.beforeAll = [hook("inner")];

    await all.ensure(testIn(inner, "one"), "firefox");
    await all.ensure(testIn(inner, "two"), "firefox");
    assert.deepEqual(log, ["outer1", "outer2", "inner"]);

    await all.ensure(testIn(inner, "three"), "chrome");
    assert.deepEqual(log.slice(3), ["outer1", "outer2", "inner"]);
  });

  it("gives the hooks the fixtures of the browser", async () => {
    const { all, hook, fixturesSeen } = setup();
    const suite = newSuite("A");
    suite.beforeAll = [hook("h")];
    await all.ensure(testIn(suite), "chrome");
    assert.equal(fixturesSeen[0]?.browserName, "chrome");
    assert.equal(fixturesSeen[0]?.workerIndex, 3);
  });

  it("enters a suite that has only afterAll hooks", async () => {
    const { all, log, hook } = setup();
    const suite = newSuite("A");
    suite.afterAll = [hook("after")];
    await all.ensure(testIn(suite), "firefox");
    assert.deepEqual(log, []);
    await all.closeAll();
    assert.deepEqual(log, ["after"]);
  });

  it("is safe for overlapping calls: the hook runs once", async () => {
    const { all, log, hook } = setup();
    const suite = newSuite("A");
    suite.beforeAll = [hook("once")];
    await Promise.all([
      all.ensure(testIn(suite, "a"), "firefox"),
      all.ensure(testIn(suite, "b"), "firefox"),
    ]);
    assert.deepEqual(log, ["once"]);
  });

  it("remembers a failure: later tests of the scope and of scopes below it reject without running anything", async () => {
    const { all, log, hook } = setup();
    const outer = newSuite("A");
    const inner = newSuite("B", outer);
    const sibling = newSuite("C");
    outer.beforeAll = [hook("bad", "boom"), hook("never")];
    inner.beforeAll = [hook("inner")];
    sibling.beforeAll = [hook("sibling")];

    const failed = (promise: Promise<void>) =>
      assert.rejects(
        promise,
        (error: HookError) =>
          error instanceof HookError &&
          error.message === "beforeAll hook failed: boom",
      );
    await failed(all.ensure(testIn(outer, "x"), "firefox"));
    await failed(all.ensure(testIn(outer, "y"), "firefox"));
    await failed(all.ensure(testIn(inner, "z"), "firefox"));
    assert.deepEqual(log, ["bad"]);

    await all.ensure(testIn(sibling), "firefox");
    assert.deepEqual(log, ["bad", "sibling"]);
  });

  it("fails a hook that outlives the limit", async () => {
    const { all } = setup(20);
    const suite = newSuite("A");
    suite.beforeAll = [() => new Promise<void>(() => {})];
    await assert.rejects(
      all.ensure(testIn(suite), "firefox"),
      /beforeAll hook failed: timed out after 0.02 seconds/,
    );
  });
});

describe("closeAll", () => {
  it("runs afterAll in reverse order of entering, each suite's hooks as written", async () => {
    const { all, log, hook } = setup();
    const outer = newSuite("A");
    const inner = newSuite("B", outer);
    outer.afterAll = [hook("outer1"), hook("outer2")];
    inner.afterAll = [hook("inner1"), hook("inner2")];
    await all.ensure(testIn(inner), "firefox");
    assert.deepEqual(await all.closeAll(), []);
    assert.deepEqual(log, ["inner1", "inner2", "outer1", "outer2"]);
  });

  it("runs the afterAll of a scope whose beforeAll failed", async () => {
    const { all, log, hook } = setup();
    const suite = newSuite("A");
    suite.beforeAll = [hook("bad", "boom")];
    suite.afterAll = [hook("after")];
    await assert.rejects(all.ensure(testIn(suite), "firefox"));
    await all.closeAll();
    assert.deepEqual(log, ["bad", "after"]);
  });

  it("returns the errors instead of throwing, and still runs the other hooks", async () => {
    const { all, log, hook } = setup();
    const suite = newSuite("A");
    suite.afterAll = [hook("first", "one"), hook("second", "two")];
    await all.ensure(testIn(suite), "firefox");
    const errors = await all.closeAll();
    assert.deepEqual(
      errors.map((e) => e.message),
      ["afterAll hook failed: one", "afterAll hook failed: two"],
    );
    assert.deepEqual(log, ["first", "second"]);
  });

  it("applies the limit, and forgets everything: a second call has nothing to do", async () => {
    const { all, log, hook } = setup(20);
    const suite = newSuite("A");
    suite.afterAll = [() => new Promise<void>(() => {}), hook("next")];
    await all.ensure(testIn(suite), "firefox");
    const errors = await all.closeAll();
    assert.match(errors[0]?.message ?? "", /afterAll hook failed: timed out/);
    assert.deepEqual(log, ["next"]);
    assert.deepEqual(await all.closeAll(), []);
    assert.deepEqual(log, ["next"]);
  });
});
