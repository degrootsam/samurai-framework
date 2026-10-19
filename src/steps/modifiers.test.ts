import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdit } from "./edit.js";
import { parseSpec } from "./parse.js";

/** A spec the way people write them once they use modifiers and hooks */
const SPEC = `import { beforeEach, describe, expect, test } from "samurai";

beforeEach(async ({ page }) => {
  await page.goto("/start");
});

test("plain", async ({ page }) => {
  await page.goto("/a");
});

test.skip("skipped", async ({ page }) => {
  await page.goto("/skipped");
});

test.fixme("broken", async ({ page }) => {
  await page.goto("/broken");
});

test.only("focused", async ({ page }) => {
  await page.goto("/focused");
});

describe.skip("Old", () => {
  test("inside a skipped describe", async ({ page }) => {
    await page.goto("/old");
  });
});

describe.only("Focus", () => {
  beforeEach(async ({ page }) => {
    await page.goto("/focus");
  });
  test("inside a focused describe", async ({ page }) => {
    await page.goto("/in-focus");
  });
});

describe("Normal", () => {
  test.skip("skipped inside", async () => {
    test.skip(true, "reason");
  });
  test("last", async ({ page }) => {
    await page.goto("/last");
  });
});
`;

describe("specs with modifiers and hooks", () => {
  it("lists the plain tests with the names the runner gives them, and nothing throws", () => {
    assert.deepEqual(
      parseSpec(SPEC).map((t) => t.name),
      [
        "plain",
        "Old > inside a skipped describe",
        "Focus > inside a focused describe",
        "Normal > last",
      ],
    );
  });

  it("does not list test.skip, test.fixme or test.only calls, nor take a hook for a test", () => {
    const names = parseSpec(SPEC).map((t) => t.name);
    for (const hidden of ["skipped", "broken", "focused", "skipped inside"])
      assert.ok(!names.some((n) => n.endsWith(hidden)), hidden);
  });

  it("an edit to a plain test leaves every modifier call and hook untouched", () => {
    const tests = parseSpec(SPEC);
    const last = tests.findIndex((t) => t.name === "Normal > last");
    const edited = applyEdit(SPEC, {
      op: "insert",
      test: last,
      index: 1,
      step: { kind: "goto", url: "/more" },
    });

    const before = SPEC.split("\n");
    const after = edited.split("\n");
    assert.equal(after.length, before.length + 1, "one line added");
    const removed = before.filter((line) => !after.includes(line));
    assert.deepEqual(removed, [], "no existing line changed or went away");
    const added = after.filter((line) => !before.includes(line));
    assert.deepEqual(added, ['    await page.goto("/more");']);
    for (const kept of [
      'test.skip("skipped", async ({ page }) => {',
      'test.fixme("broken", async ({ page }) => {',
      'test.only("focused", async ({ page }) => {',
      'describe.skip("Old", () => {',
      "beforeEach(async ({ page }) => {",
      '    test.skip(true, "reason");',
    ])
      assert.ok(edited.includes(kept), kept);
  });

  it("an edit to a test inside describe.skip finds the right test", () => {
    const index = parseSpec(SPEC).findIndex(
      (t) => t.name === "Old > inside a skipped describe",
    );
    const edited = applyEdit(SPEC, { op: "remove", test: index, index: 0 });
    assert.ok(!edited.includes('page.goto("/old")'));
    assert.ok(edited.includes('page.goto("/skipped")'));
    assert.ok(edited.includes('page.goto("/in-focus")'));
  });
});
