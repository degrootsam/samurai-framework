import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearRegistry,
  describe as samuraiDescribe,
  registeredTests,
  test as samuraiTest,
} from "./registry.js";
import { afterEachOf, beforeEachOf } from "./suite.js";

afterEach(() => clearRegistry());

const noop = async () => {};

test("test.describe is describe, with skip, fixme and only", () => {
  assert.equal(samuraiTest.describe, samuraiDescribe);
  assert.equal(samuraiTest.describe.skip, samuraiDescribe.skip);
  assert.equal(samuraiTest.describe.fixme, samuraiDescribe.fixme);
  assert.equal(samuraiTest.describe.only, samuraiDescribe.only);
});

test("test.describe nests and names tests like describe", () => {
  samuraiTest.describe("Checkout", () => {
    samuraiTest.describe("Guest", () => samuraiTest("pays", noop));
  });
  samuraiTest.describe.skip("Old", () => samuraiTest("gone", noop));
  assert.deepEqual(
    registeredTests().map((t) => [t.name, t.modifier]),
    [
      ["Checkout > Guest > pays", undefined],
      ["Old > gone", "skip"],
    ],
  );
});

test("test.beforeEach, afterEach, beforeAll and afterAll register on the suite they are written in", () => {
  const a = () => {};
  const b = () => {};
  const c = () => {};
  const d = () => {};
  const top = () => {};
  samuraiTest.beforeEach(top);
  samuraiTest.describe("A", () => {
    samuraiTest.beforeEach(a);
    samuraiTest.afterEach(b);
    samuraiTest.beforeAll(c);
    samuraiTest.afterAll(d);
    samuraiTest("one", noop);
  });
  const [one] = registeredTests();
  assert.deepEqual(beforeEachOf(one!.suite), [top, a]);
  assert.deepEqual(afterEachOf(one!.suite), [b]);
  assert.deepEqual(one?.suite.beforeAll, [c]);
  assert.deepEqual(one?.suite.afterAll, [d]);
});

test("a test registered through the aliases records the spec file of the caller", () => {
  samuraiTest.describe("A", () => samuraiTest("one", noop));
  assert.match(registeredTests()[0]?.file ?? "", /registry-aliases\.test\.ts$/);
});

test("a registered test knows its line and column", () => {
  samuraiTest("here", noop);
  const [registered] = registeredTests();
  assert.equal(typeof registered?.line, "number");
  assert.ok((registered?.line ?? 0) > 40, "a line of this file");
  assert.equal(typeof registered?.column, "number");
});

test("test.info() throws outside a test", () => {
  assert.throws(() => samuraiTest.info(), {
    message: "info(): no test is running",
  });
});

test("test.skip with a function outside a test says it needs one", () => {
  assert.throws(() => samuraiTest.skip(() => true, "x"), {
    message: "test.skip(): a condition function needs a running test",
  });
  assert.equal(registeredTests().length, 0, "it registers no test");
});
