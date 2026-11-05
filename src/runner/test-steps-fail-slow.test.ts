import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { RegisteredTestCase, TestFixtures } from "../types/test.js";
import {
  clearRegistry,
  registeredTests,
  describe,
  test as t,
} from "./registry.js";
import { judgeExpectation } from "./test-annotations.js";
import { currentStepLog, runInTestScope, TestInfoImpl } from "./test-info.js";
import { TestTimeout } from "./test-timeout.js";
import { SkipSignal } from "./skip.js";
import { newSuite } from "./suite.js";

afterEach(() => clearRegistry());

const registered: RegisteredTestCase = {
  name: "a",
  titlePath: ["a"],
  file: "/p/a.spec.ts",
  suite: newSuite(),
  function: async () => {},
};

function infoWith(timeout = 1000, onExpire = () => {}) {
  const limit = new TestTimeout(timeout, onExpire);
  const info = new TestInfoImpl({
    test: registered,
    browserName: "firefox",
    workerIndex: 0,
    retry: 0,
    settings: { baseURL: undefined, timeout },
    timeout: limit,
    resultDir: "/r",
    outputDir: path.join("/r", "a"),
  });
  return { info, limit };
}

const inScope = <T>(info: TestInfoImpl, fn: () => T) =>
  runInTestScope({ info, fixtures: {} as TestFixtures }, fn);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a timeout re-armed mid-test counts from the start of the test", async () => {
  let expired = 0;
  const { limit } = infoWith(60_000, () => expired++);
  limit.start();
  await wait(50);
  limit.set(70); // 70 ms from the start: about 20 ms left
  await wait(10);
  assert.equal(expired, 0);
  await wait(60);
  assert.equal(expired, 1);
  limit.stop();
});

test("a limit already passed expires now, and 0 removes the limit", async () => {
  let expired = 0;
  const first = new TestTimeout(60_000, () => expired++);
  first.start();
  await wait(20);
  first.set(5);
  await wait(20);
  assert.equal(expired, 1);
  const second = new TestTimeout(10, () => expired++);
  second.start();
  second.set(0);
  await wait(30);
  assert.equal(expired, 1);
  second.stop();
});

test("slow triples the timeout once and adds one annotation", () => {
  const { info } = infoWith(1000);
  info.slow(false);
  assert.equal(info.timeout, 1000);
  info.slow(true, "big page");
  info.slow();
  assert.equal(info.timeout, 3000);
  assert.deepEqual(info.annotations, [
    { type: "slow", description: "big page" },
  ]);
  info.setTimeout(500);
  assert.equal(info.timeout, 500);
});

test("setTimeout rejects what is not a number of milliseconds", () => {
  const { info } = infoWith();
  for (const bad of [-1, NaN, Infinity, "5", undefined])
    assert.throws(
      () => info.setTimeout(bad as number),
      /^Error: setTimeout\(\): /,
    );
});

test("fail sets the expected status and notes it once; skip and fixme throw the skip signal", () => {
  const { info } = infoWith();
  info.fail(false);
  assert.equal(info.expectedStatus, "passed");
  info.fail(true, "bug 1");
  info.fail();
  assert.equal(info.expectedStatus, "failed");
  assert.deepEqual(info.annotations, [{ type: "fail", description: "bug 1" }]);
  assert.throws(() => info.skip(true, "no"), SkipSignal);
  assert.throws(() => info.fixme(), SkipSignal);
  assert.doesNotThrow(() => info.skip(false));
});

test("judgeExpectation flips the verdict of a test expected to fail, but not a timeout", () => {
  const { info } = infoWith();
  const err = { message: "boom", type: "assertion" as const };
  assert.equal(judgeExpectation(info, err), err);
  assert.equal(judgeExpectation(info, undefined), undefined);
  info.fail();
  assert.equal(judgeExpectation(info, err), undefined);
  assert.deepEqual(judgeExpectation(info, undefined), {
    message: "expected to fail, but passed",
    type: "error",
  });
  const timeout = { message: "late", type: "timeout" as const };
  assert.equal(judgeExpectation(info, timeout), timeout);
});

test("steps nest, return their value, and are listed with their outcome", async () => {
  const { info } = infoWith();
  const value = await inScope(info, () =>
    t.step("outer", async () => {
      await t.step("inner", () => wait(5));
      await assert.rejects(
        t.step("bad", () => Promise.reject(new Error("nope"))),
        /nope/,
      );
      return 42;
    }),
  );
  assert.equal(value, 42);
  const [outer, ...rest] = info.reportExtras().steps ?? [];
  assert.equal(rest.length, 0);
  assert.equal(outer?.title, "outer");
  assert.equal(outer?.status, "passed");
  assert.deepEqual(
    outer?.steps?.map((s) => [s.title, s.status, s.error]),
    [
      ["inner", "passed", undefined],
      ["bad", "failed", "nope"],
    ],
  );
  assert.equal("steps" in (outer?.steps?.[0] ?? {}), false);
});

test("a step with no steps is absent from the extras, a step timeout fails it, and arguments are checked", async () => {
  const { info } = infoWith();
  assert.equal("steps" in info.reportExtras(), false);
  await inScope(info, async () => {
    await assert.rejects(
      t.step("slow", () => wait(200), { timeout: 20 }),
      /step "slow" timed out after 20 ms/,
    );
    await assert.rejects(
      async () => t.step("", async () => {}),
      /^TypeError: step\(\): the title/,
    );
    await assert.rejects(
      async () => t.step("x", 1 as never),
      /^TypeError: step\(\): needs a function/,
    );
    await assert.rejects(
      async () => t.step("x", async () => {}, { timeout: -1 }),
      /^Error: step\(\): the timeout/,
    );
  });
  assert.equal(info.reportExtras().steps?.[0]?.status, "failed");
});

test("a step cut short is listed as unfinished", () => {
  const { info } = infoWith();
  void inScope(info, () => t.step("hang", () => new Promise(() => {})));
  assert.equal(
    info.reportExtras().steps?.[0]?.error,
    "the test ended before the step finished",
  );
});

test("step, setTimeout and a condition function need a running test", () => {
  assert.throws(() => currentStepLog(), /^Error: step\(\): no test is running/);
  assert.throws(
    () => t.setTimeout(5),
    /^Error: setTimeout\(\): no test is running/,
  );
  assert.throws(
    () => t.fail((() => true) as never),
    /^Error: fail\(\): a condition function needs a running test/,
  );
});

test("test.fail(title, fn) registers an expected failure; fail and slow in a describe mark its tests", () => {
  t.fail("known bug", { reason: "bug 7" }, async () => {});
  describe("group", () => {
    t.slow(true, "heavy");
    t.fail(false);
    t("inside", async () => {});
    describe("nested", () => {
      t.fail(true, "all of them");
      t("deep", async () => {});
    });
  });
  t("outside", async () => {});
  const [bug, inside, deep, outside] = registeredTests();
  assert.deepEqual(bug?.expectedFail, { description: "bug 7" });
  assert.deepEqual(inside?.suite.marks, [
    { type: "slow", description: "heavy" },
  ]);
  assert.deepEqual(deep?.suite.parent?.marks, [
    { type: "slow", description: "heavy" },
  ]);
  assert.deepEqual(deep?.suite.marks, [
    { type: "fail", description: "all of them" },
  ]);
  assert.equal(outside?.suite.marks, undefined);
  assert.equal(outside?.expectedFail, undefined);
});

test("test.fail('title', fn) takes the same arguments as test()", () => {
  assert.throws(
    () => t.fail("t", 5 as never),
    /needs a function as its last argument/,
  );
});
