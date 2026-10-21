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
  it("lists every test with the name the runner gives it, and nothing throws", () => {
    assert.deepEqual(
      parseSpec(SPEC).map((t) => t.name),
      [
        "plain",
        "skipped",
        "broken",
        "focused",
        "Old > inside a skipped describe",
        "Focus > inside a focused describe",
        "Normal > skipped inside",
        "Normal > last",
      ],
    );
  });

  it("gives each test the modifier the runner applies, a describe's included", () => {
    assert.deepEqual(
      Object.fromEntries(parseSpec(SPEC).map((t) => [t.name, t.modifier])),
      {
        plain: undefined,
        skipped: "skip",
        broken: "fixme",
        focused: "only",
        "Old > inside a skipped describe": "skip",
        "Focus > inside a focused describe": "only",
        "Normal > skipped inside": "skip",
        "Normal > last": undefined,
      },
    );
  });

  it("a skip beats a focus, and the innermost skip or fixme wins", () => {
    const tests = parseSpec(`describe.only("A", () => {
  test.skip("x", async () => {});
  describe.fixme("B", () => {
    test("y", async () => {});
    test.only("z", async () => {});
  });
});
describe.skip("C", () => {
  test.fixme("w", async () => {});
});
`);
    assert.deepEqual(
      tests.map((t) => [t.name, t.modifier]),
      [
        ["A > x", "skip"],
        ["A > B > y", "fixme"],
        ["A > B > z", "fixme"],
        ["C > w", "fixme"],
      ],
    );
  });

  it("reads the steps of a test.skip test; test.skip(condition, reason) in a body is a step, not a test", () => {
    const tests = parseSpec(SPEC);
    const skipped = tests.find((t) => t.name === "skipped")!;
    assert.deepEqual(
      skipped.steps.map((s) => s.step),
      [{ kind: "goto", url: "/skipped" }],
    );
    const inside = tests.find((t) => t.name === "Normal > skipped inside")!;
    assert.equal(inside.steps.length, 1);
    assert.equal(inside.steps[0]!.step.kind, "custom");
    assert.ok(!tests.some((t) => t.name.endsWith("reason")));
  });

  it("reads the { reason } of a skip or fixme, from the test or the describe that decides", () => {
    const source = `test.skip("a", { reason: "waits for v2" }, async ({ page }) => {
  await page.goto("/a");
});
test.fixme("b", {}, async () => {});
describe.skip("Old", { reason: "replaced" }, () => {
  test("c", async () => {});
  test.fixme("d", { reason: "own" }, async () => {});
});
describe.only("Focus", () => {
  test.only("e", async () => {});
});
`;
    const tests = parseSpec(source);
    assert.deepEqual(
      tests.map((t) => [t.name, t.modifier, t.reason]),
      [
        ["a", "skip", "waits for v2"],
        ["b", "fixme", undefined],
        ["Old > c", "skip", "replaced"],
        ["Old > d", "fixme", "own"],
        ["Focus > e", "only", undefined],
      ],
    );
    assert.ok(!("reason" in tests[1]!), "no reason key without one");
    assert.deepEqual(
      tests[0]!.steps.map((s) => s.step),
      [{ kind: "goto", url: "/a" }],
    );
    const edited = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 1,
      step: { kind: "goto", url: "/more" },
    });
    assert.ok(
      edited.includes('test.skip("a", { reason: "waits for v2" }, async'),
    );
    assert.equal(parseSpec(edited)[0]!.steps.length, 2);
  });

  it("does not take a hook for a test", () => {
    const names = parseSpec(SPEC).map((t) => t.name);
    assert.ok(!names.some((n) => n.includes("beforeEach")));
    assert.equal(names.length, 8);
  });

  it("an edit to a test.skip test keeps its modifier and every other line", () => {
    const index = parseSpec(SPEC).findIndex((t) => t.name === "broken");
    const edited = applyEdit(SPEC, {
      op: "insert",
      test: index,
      index: 1,
      step: { kind: "goto", url: "/more" },
    });
    const before = SPEC.split("\n");
    const after = edited.split("\n");
    assert.equal(after.length, before.length + 1, "one line added");
    assert.deepEqual(
      before.filter((line) => !after.includes(line)),
      [],
      "no existing line changed or went away",
    );
    assert.deepEqual(
      after.filter((line) => !before.includes(line)),
      ['  await page.goto("/more");'],
    );
    const reparsed = parseSpec(edited).find((t) => t.name === "broken")!;
    assert.equal(reparsed.modifier, "fixme");
    assert.equal(reparsed.steps.length, 2);
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
