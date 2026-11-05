import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearRegistry,
  registeredTests,
  test as samuraiTest,
} from "./registry.js";
import { useOf } from "./suite.js";

afterEach(() => clearRegistry());

const noop = async () => {};

test("test.use at the top level applies to every test of the file, also ones written before it", () => {
  samuraiTest("early", noop);
  samuraiTest.use({ locale: "nl-NL" });
  samuraiTest("late", noop);
  for (const t of registeredTests())
    assert.deepEqual(useOf(t.suite), [{ locale: "nl-NL" }]);
});

test("test.use in a describe applies to that block only, outermost first", () => {
  samuraiTest.use({ locale: "nl-NL", colorScheme: "dark" });
  samuraiTest.describe("A", () => {
    samuraiTest.use({ locale: "de-DE" });
    samuraiTest("inside", noop);
    samuraiTest.describe("B", () => {
      samuraiTest.use({ userAgent: "x" });
      samuraiTest("deeper", noop);
    });
  });
  samuraiTest.describe("C", () => samuraiTest("sibling", noop));
  const byName = Object.fromEntries(
    registeredTests().map((t) => [t.name, useOf(t.suite)]),
  );
  assert.deepEqual(byName["A > inside"], [
    { locale: "nl-NL", colorScheme: "dark" },
    { locale: "de-DE" },
  ]);
  assert.deepEqual(byName["A > B > deeper"], [
    { locale: "nl-NL", colorScheme: "dark" },
    { locale: "de-DE" },
    { userAgent: "x" },
  ]);
  assert.deepEqual(byName["C > sibling"], [
    { locale: "nl-NL", colorScheme: "dark" },
  ]);
});

test("test.use refuses a wrong option when it is written", () => {
  assert.throws(
    () => samuraiTest.use({ isMobile: "yes" } as never),
    /use\(\): isMobile must be true or false/,
  );
});
