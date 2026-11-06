import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  clearRegistry,
  registeredTests,
  test as samuraiTest,
} from "./registry.js";
import { newSuite } from "./suite.js";
import { TestInfoImpl } from "./test-info.js";

const noop = async () => {};
beforeEach(() => clearRegistry());

const PLAN = { type: "plan", description: "plans/pay.plan.md" };

test("annotations are registered with the test, and left out when empty", () => {
  samuraiTest("a", { annotations: [PLAN, { type: "issue" }] }, noop);
  samuraiTest("b", { annotations: [] }, noop);
  samuraiTest("c", noop);
  const [a, b, c] = registeredTests();
  assert.deepEqual(a?.annotations, [PLAN, { type: "issue" }]);
  assert.ok(!("annotations" in b!) && !("annotations" in c!));
});

test("test.only and test.skip take annotations too", () => {
  samuraiTest.only("a", { annotations: [PLAN] }, noop);
  samuraiTest.skip("b", { annotations: [PLAN], reason: "later" }, noop);
  const [a, b] = registeredTests();
  assert.deepEqual(a?.annotations, [PLAN]);
  assert.deepEqual(b?.annotations, [PLAN]);
});

test("a bad annotations option is a test(): error", () => {
  const bad: [unknown, RegExp][] = [
    ["plan", /test\(\): annotations must be an array/],
    [[null], /test\(\): each annotation must be an object/],
    [[{ type: "" }], /test\(\): an annotation needs a non-empty type/],
    [[{ type: 3 }], /test\(\): an annotation needs a non-empty type/],
    [
      [{ type: "a", description: 1 }],
      /test\(\): the description of annotation "a"/,
    ],
  ];
  for (const [annotations, message] of bad)
    assert.throws(
      () => samuraiTest("t", { annotations } as never, noop),
      message,
    );
});

test("a run starts with the declared annotations and later ones follow", () => {
  samuraiTest("t", { annotations: [PLAN] }, noop);
  const info = new TestInfoImpl({
    test: { ...registeredTests()[0]!, suite: newSuite() },
    browserName: "firefox",
    workerIndex: 0,
    retry: 0,
    settings: { baseURL: undefined, timeout: 5000 },
    resultDir: "/r",
    outputDir: "/r/a",
  });
  info.slow(true, "big");
  assert.deepEqual(info.annotations, [
    PLAN,
    { type: "slow", description: "big" },
  ]);
  // the declared list is copied: a run cannot change the registered test
  assert.deepEqual(registeredTests()[0]?.annotations, [PLAN]);
});
