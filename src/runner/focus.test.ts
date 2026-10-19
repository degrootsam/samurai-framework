import assert from "node:assert/strict";
import { test } from "node:test";
import type { Modifier, RegisteredTestCase } from "../types/test.js";
import { assertNoOnly, narrowToOnly } from "./focus.js";
import { newSuite } from "./suite.js";

const testCase = (
  name: string,
  modifier?: Modifier,
  file = "/proj/src/a.spec.ts",
): RegisteredTestCase => ({
  name,
  file,
  titlePath: [name],
  suite: newSuite(),
  function: async () => {},
  ...(modifier && { modifier }),
});

test("without a focused test, nothing is narrowed", () => {
  const all = [testCase("a"), testCase("b", "skip")];
  assert.deepEqual(narrowToOnly(all), all);
});

test("with a focused test, only the focused ones stay", () => {
  const all = [testCase("a"), testCase("b", "only"), testCase("c", "only")];
  assert.deepEqual(
    narrowToOnly(all).map((t) => t.name),
    ["b", "c"],
  );
});

test("a focused test that selection removed does not narrow the rest", () => {
  const selected = [testCase("a"), testCase("c")];
  assert.deepEqual(narrowToOnly(selected), selected);
});

test("forbidding lists every focused test with its file relative to srcDir", () => {
  const all = [
    testCase("a", "only"),
    testCase("b"),
    testCase("c", "only", "/proj/src/sub/c.spec.ts"),
  ];
  assert.throws(
    () => assertNoOnly(all, true, "/proj/src"),
    (error: Error) =>
      error.message ===
      [
        "test.only is not allowed (forbidOnly): a.spec.ts: a",
        "test.only is not allowed (forbidOnly): sub/c.spec.ts: c",
      ].join("\n"),
  );
});

test("allowing, or nothing focused, does not throw", () => {
  assertNoOnly([testCase("a", "only")], false, "/proj/src");
  assertNoOnly([testCase("a")], true, "/proj/src");
});
