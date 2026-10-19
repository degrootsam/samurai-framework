import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  clearRegistry,
  describe as samuraiDescribe,
  registeredTests,
  test as samuraiTest,
} from "./registry.js";

afterEach(() => clearRegistry());

const noop = async () => {};

test("a test outside describe keeps its title", () => {
  samuraiTest("logs in", noop);
  const [registered] = registeredTests();
  assert.equal(registered?.name, "logs in");
  assert.deepEqual(registered?.titlePath, ["logs in"]);
  assert.equal(registered?.function, noop);
});

test("nested describe titles are joined with >", () => {
  samuraiDescribe("Checkout", () => {
    samuraiDescribe("Guest", () => {
      samuraiTest("applies coupon", noop);
    });
    samuraiTest("pays with saved card", noop);
  });
  samuraiTest("after", noop);
  assert.deepEqual(
    registeredTests().map((t) => t.name),
    [
      "Checkout > Guest > applies coupon",
      "Checkout > pays with saved card",
      "after",
    ],
  );
});

test("the title stack is restored when a describe callback throws", () => {
  assert.throws(() =>
    samuraiDescribe("Broken", () => {
      throw new Error("boom");
    }),
  );
  samuraiTest("after", noop);
  assert.equal(registeredTests()[0]?.name, "after");
});

test("an async describe callback is rejected", () => {
  assert.throws(() => samuraiDescribe("Async", async () => {}), {
    message: "describe() callback must be synchronous; it only registers tests",
  });
  samuraiTest("after", noop);
  assert.equal(registeredTests()[0]?.name, "after");
});

test("records the calling spec file", () => {
  samuraiTest("where", noop);
  assert.equal(registeredTests()[0]?.file, fileURLToPath(import.meta.url));
});

test("a plain test has no modifier", () => {
  samuraiTest("plain", noop);
  assert.equal(registeredTests()[0]?.modifier, undefined);
});

test("test.skip, test.fixme and test.only register a test with that modifier", () => {
  samuraiTest.skip("skipped", noop);
  samuraiTest.fixme("fixme", noop);
  samuraiTest.only("focused", noop);
  assert.deepEqual(
    registeredTests().map((t) => [t.name, t.modifier]),
    [
      ["skipped", "skip"],
      ["fixme", "fixme"],
      ["focused", "only"],
    ],
  );
});

test("every entry point records the spec file that called it", () => {
  const file = fileURLToPath(import.meta.url);
  samuraiTest("plain", noop);
  samuraiTest.skip("skip", noop);
  samuraiTest.fixme("fixme", noop);
  samuraiTest.only("only", noop);
  samuraiDescribe("d", () => samuraiTest("in describe", noop));
  samuraiDescribe.skip("ds", () => samuraiTest("in skip", noop));
  samuraiDescribe.fixme("df", () => samuraiTest("in fixme", noop));
  samuraiDescribe.only("do", () => samuraiTest("in only", noop));
  assert.equal(registeredTests().length, 8);
  assert.ok(registeredTests().every((t) => t.file === file));
});

test("describe.skip, describe.fixme and describe.only give their tests the modifier, through nesting", () => {
  samuraiDescribe.skip("A", () => {
    samuraiTest("a1", noop);
    samuraiDescribe("B", () => samuraiTest("b1", noop));
  });
  samuraiDescribe.fixme("C", () => samuraiTest("c1", noop));
  samuraiDescribe.only("D", () => {
    samuraiDescribe("E", () => samuraiTest("e1", noop));
  });
  samuraiTest("outside", noop);
  assert.deepEqual(
    registeredTests().map((t) => [t.name, t.modifier]),
    [
      ["A > a1", "skip"],
      ["A > B > b1", "skip"],
      ["C > c1", "fixme"],
      ["D > E > e1", "only"],
      ["outside", undefined],
    ],
  );
});

test("a skip beats a focus, whichever is outside", () => {
  samuraiDescribe.only("focused", () => {
    samuraiTest.skip("skipped inside", noop);
    samuraiTest("plain inside", noop);
  });
  samuraiDescribe.skip("skipped", () => {
    samuraiTest.only("focused inside", noop);
  });
  assert.deepEqual(
    registeredTests().map((t) => [t.name, t.modifier]),
    [
      ["focused > skipped inside", "skip"],
      ["focused > plain inside", "only"],
      ["skipped > focused inside", "skip"],
    ],
  );
});

test("a test knows the describe block it is written in", () => {
  samuraiDescribe("A", () => {
    samuraiTest("one", noop);
    samuraiTest("two", noop);
  });
  samuraiTest("top", noop);
  const [one, two, top] = registeredTests();
  assert.equal(one?.suite, two?.suite);
  assert.equal(one?.suite.title, "A");
  assert.notEqual(one?.suite, top?.suite);
  assert.equal(top?.suite.title, undefined);
  assert.equal(one?.suite.parent, top?.suite);
});

test("test.skip(condition) throws a skip signal only when the condition is true", () => {
  samuraiTest.skip(false, "never");
  assert.throws(() => samuraiTest.skip(true, "needs Chrome"), {
    name: "SkipSignal",
    message: "needs Chrome",
    annotation: "skip",
    reason: "needs Chrome",
  });
  assert.throws(() => samuraiTest.fixme(true), {
    annotation: "fixme",
    reason: undefined,
  });
  assert.equal(
    registeredTests().length,
    0,
    "the condition forms register nothing",
  );
});
