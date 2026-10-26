import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  afterAll as samuraiAfterAll,
  afterEach as samuraiAfterEach,
  beforeAll as samuraiBeforeAll,
  beforeEach as samuraiBeforeEach,
  clearRegistry,
  describe as samuraiDescribe,
  registeredTests,
  test as samuraiTest,
} from "./registry.js";
import { afterEachOf, beforeEachOf } from "./suite.js";

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

test("test.skip and test.fixme take an optional { reason } before the body", () => {
  samuraiTest.skip("skipped", { reason: "waits for the new API" }, noop);
  samuraiTest.fixme("broken", { reason: "flaky on CI" }, noop);
  samuraiTest.skip("no reason", {}, noop);
  samuraiTest.skip("plain form", noop);
  assert.deepEqual(
    registeredTests().map((t) => [t.name, t.modifier, t.reason, t.function]),
    [
      ["skipped", "skip", "waits for the new API", noop],
      ["broken", "fixme", "flaky on CI", noop],
      ["no reason", "skip", undefined, noop],
      ["plain form", "skip", undefined, noop],
    ],
  );
  assert.ok(!("reason" in registeredTests()[2]!), "no reason key without one");
});

test("describe.skip and describe.fixme take a { reason } that their tests get, the innermost skip's reason winning", () => {
  samuraiDescribe.skip("Old", { reason: "replaced by v2" }, () => {
    samuraiTest("a", noop);
    samuraiTest.fixme("b", { reason: "own reason" }, noop);
    samuraiTest.fixme("c", noop);
  });
  samuraiDescribe.fixme("Broken", () => samuraiTest("d", noop));
  samuraiDescribe.only("Focus", () =>
    samuraiDescribe.fixme("Inner", { reason: "inner" }, () =>
      samuraiTest.only("e", noop),
    ),
  );
  assert.deepEqual(
    registeredTests().map((t) => [t.name, t.modifier, t.reason]),
    [
      ["Old > a", "skip", "replaced by v2"],
      ["Old > b", "fixme", "own reason"],
      ["Old > c", "fixme", undefined],
      ["Broken > d", "fixme", undefined],
      ["Focus > Inner > e", "fixme", "inner"],
    ],
  );
});

test("test.skip with a title but no body is refused", () => {
  assert.throws(
    // @ts-expect-error a test needs a body
    () => samuraiTest.skip("no body", { reason: "x" }),
    /test\.skip\("no body"\) needs a function/,
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

test("hooks belong to the describe block they are written in, or to the file", () => {
  const top = () => {};
  const inner = () => {};
  samuraiBeforeEach(top);
  samuraiDescribe("A", () => {
    samuraiBeforeEach(inner);
    samuraiAfterEach(inner);
    samuraiBeforeAll(inner);
    samuraiAfterAll(inner);
    samuraiTest("one", noop);
  });
  samuraiTest("two", noop);
  const [one, two] = registeredTests();
  assert.deepEqual(one?.suite.beforeEach, [inner]);
  assert.deepEqual(one?.suite.afterEach, [inner]);
  assert.deepEqual(one?.suite.beforeAll, [inner]);
  assert.deepEqual(one?.suite.afterAll, [inner]);
  assert.deepEqual(two?.suite.beforeEach, [top]);
  assert.equal(two?.suite.afterEach, undefined);
});

test("beforeEach hooks run outermost first, afterEach innermost first, each suite in the order written", () => {
  const order = ["root1", "root2", "outer", "inner"].map((name) => ({
    name,
    fn: () => {},
  }));
  const [root1, root2, outer, inner] = order.map((o) => o.fn) as [
    () => void,
    () => void,
    () => void,
    () => void,
  ];
  samuraiBeforeEach(root1);
  samuraiAfterEach(root1);
  samuraiBeforeEach(root2);
  samuraiAfterEach(root2);
  samuraiDescribe("A", () => {
    samuraiBeforeEach(outer);
    samuraiAfterEach(outer);
    samuraiDescribe("B", () => {
      samuraiBeforeEach(inner);
      samuraiAfterEach(inner);
      samuraiTest("t", noop);
    });
  });
  const suite = registeredTests()[0]!.suite;
  assert.deepEqual(beforeEachOf(suite), [root1, root2, outer, inner]);
  assert.deepEqual(afterEachOf(suite), [inner, outer, root1, root2]);
});

test("clearRegistry forgets the hooks of a file", () => {
  samuraiBeforeEach(noop);
  samuraiTest("t", noop);
  assert.equal(registeredTests()[0]?.suite.beforeEach?.length, 1);
  clearRegistry();
  samuraiTest("fresh", noop);
  assert.equal(registeredTests()[0]?.suite.beforeEach, undefined);
});

test("inputs and outputs are registered with the test", () => {
  samuraiTest("t", { inputs: { a: "1" }, outputs: ["o"] }, noop);
  samuraiTest("plain", noop);
  const [withIO, plain] = registeredTests();
  assert.deepEqual(withIO?.inputs, { a: "1" });
  assert.deepEqual(withIO?.outputs, ["o"]);
  assert.ok(!("inputs" in plain!) && !("outputs" in plain!));
  assert.equal(withIO?.function, noop);
});

test("test.only takes the options too", () => {
  samuraiTest.only("t", { outputs: ["o"] }, noop);
  const [registered] = registeredTests();
  assert.equal(registered?.modifier, "only");
  assert.deepEqual(registered?.outputs, ["o"]);
});

test("test.skip and test.fixme keep the reason next to inputs and outputs", () => {
  samuraiTest.skip("s", { reason: "r", outputs: ["o"] }, noop);
  samuraiTest.fixme("f", { reason: "broken", inputs: { a: "1" } }, noop);
  const [skipped, fixme] = registeredTests();
  assert.equal(skipped?.modifier, "skip");
  assert.equal(skipped?.reason, "r");
  assert.deepEqual(skipped?.outputs, ["o"]);
  assert.equal(fixme?.modifier, "fixme");
  assert.equal(fixme?.reason, "broken");
  assert.deepEqual(fixme?.inputs, { a: "1" });
});

test("a reason on test() or test.only() throws", () => {
  assert.throws(() => samuraiTest("t", { reason: "r" }, noop), {
    message: "test(): reason only applies to skip and fixme",
  });
  assert.throws(() => samuraiTest.only("t", { reason: "r" }, noop), {
    message: "test.only(): reason only applies to skip and fixme",
  });
  assert.equal(registeredTests().length, 0);
});

test("a bad name, a duplicate or a non-string default throws at registration", () => {
  assert.throws(() => samuraiTest("t", { outputs: ["status"] }, noop), {
    message: 'test(): output "status" is not a valid name',
  });
  assert.throws(() => samuraiTest("t", { outputs: ["o", "o"] }, noop), {
    message: 'test(): output "o" is listed twice',
  });
  assert.throws(
    () => samuraiTest.skip("t", { inputs: { a: 1 as never } }, noop),
    { message: 'test.skip(): input "a" needs a string default' },
  );
  assert.equal(registeredTests().length, 0);
});

test("describe.skip keeps only the reason in its details", () => {
  samuraiDescribe.skip("D", { reason: "r" }, () => {
    samuraiTest("inside", noop);
  });
  assert.equal(registeredTests()[0]?.reason, "r");
});
