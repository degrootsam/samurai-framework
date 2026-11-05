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

test("test.extend registers into the same registry, chains, and keeps the API", () => {
  const first = samuraiTest.extend<{ one: number }>({ one: 1 });
  const second = first.extend<{ two: number }>({ two: 2 });
  samuraiTest("plain", noop);
  first("with one", noop);
  second.describe("group", () =>
    second("with two", async ({ one, two }) => void (one + two)),
  );
  second.beforeEach(async ({ one }) => void one);
  second.skip("skipped", noop);
  const tests = registeredTests();
  assert.deepEqual(
    tests.map((t) => t.name),
    ["plain", "with one", "group > with two", "skipped"],
  );
  assert.equal(tests[0]!.extension, undefined);
  assert.deepEqual([...tests[1]!.extension!.keys()], ["one"]);
  assert.deepEqual([...tests[2]!.extension!.keys()], ["one", "two"]);
  assert.equal(tests[3]!.modifier, "skip");
  assert.equal(tests[1]!.line !== undefined, true);
});

test("test.extend throws extend() errors at the call", () => {
  assert.throws(
    () =>
      samuraiTest.extend({ a: [async () => {}, { scope: "file" }] } as never),
    /^Error: extend\(\): /,
  );
});

test("test.extend types the custom fixtures in the body, the hooks and the setup functions", () => {
  const typed = samuraiTest.extend<{ n: number; label: string }>({
    n: async ({ page, baseURL }, use) => {
      void page.url;
      const url: string | undefined = baseURL;
      await use(url ? 1 : 2);
    },
    label: [async ({ n }, use) => use(`n${n.toFixed()}`), { auto: true }],
  });
  typed("typed", async ({ n, label, page }) => {
    const total: number = n;
    const text: string = label;
    void [total, text, page.url];
    // @ts-expect-error not a fixture
    void ({} as Parameters<Parameters<typeof typed>[1]>[0]).missing;
  });
  typed.beforeEach(async ({ n }) => void n.toFixed());
  assert.equal(registeredTests().length, 1);
  // @ts-expect-error the value has the wrong type
  samuraiTest.extend<{ n: number }>({ n: "text" });
});
