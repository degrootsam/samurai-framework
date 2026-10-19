import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stepsOf, wrap } from "../testing/spec-source.js";
import { applyEdit } from "./edit.js";
import type { Step } from "./model.js";

describe("applyEdit", () => {
  const source = wrap(
    "await page.goto('/');",
    "// the button",
    "await page.getByCss('b').click();",
    "const x = 1; // keep",
  );

  it("replace changes only that statement", () => {
    const next = applyEdit(source, {
      op: "replace",
      test: 0,
      index: 0,
      step: { kind: "goto", url: "/home" },
    });
    assert.equal(
      next,
      source.replace("await page.goto('/');", 'await page.goto("/home");'),
    );
  });

  it("insert goes above the step and its comments, with the same indentation", () => {
    const next = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 1,
      step: { kind: "waitForNetworkIdle" },
    });
    assert.equal(
      next,
      source.replace(
        "  // the button",
        "  await page.waitForNetworkIdle();\n  // the button",
      ),
    );
  });

  it("insert at the end appends after the last statement", () => {
    const next = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 3,
      step: { kind: "waitForNetworkIdle" },
    });
    assert.equal(
      next,
      source.replace(
        "// keep\n",
        "// keep\n  await page.waitForNetworkIdle();\n",
      ),
    );
  });

  it("insert into an empty body", () => {
    const empty = `test("t", async () => {});\n`;
    const next = applyEdit(empty, {
      op: "insert",
      test: 0,
      index: 0,
      step: { kind: "goto", url: "/" },
    });
    assert.equal(
      next,
      `test("t", async () => {\n  await page.goto("/");\n});\n`,
    );
    assert.deepEqual(stepsOf(next), [{ kind: "goto", url: "/" }]);
  });

  it("remove deletes the statement's lines, comments included", () => {
    const next = applyEdit(source, { op: "remove", test: 0, index: 1 });
    assert.equal(
      next,
      source.replace(
        "  // the button\n  await page.getByCss('b').click();\n",
        "",
      ),
    );
  });

  it("move reorders and leaves the rest alone", () => {
    const next = applyEdit(source, { op: "move", test: 0, from: 0, to: 1 });
    const steps = stepsOf(next);
    assert.equal(steps[0]!.kind, "click");
    assert.equal(steps[1]!.kind, "goto");
    assert.equal(steps.length, 3);
    assert.match(next, /const x = 1; \/\/ keep/);
  });

  it("edits the right test of several", () => {
    const two = `test("a", async () => {\n  await page.goto("/a");\n});\ntest("b", async () => {\n  await page.goto("/b");\n});\n`;
    const next = applyEdit(two, {
      op: "replace",
      test: 1,
      index: 0,
      step: { kind: "goto", url: "/c" },
    });
    assert.equal(next, two.replace("/b", "/c"));
  });

  it("rejects out-of-range positions", () => {
    assert.throws(
      () => applyEdit(source, { op: "remove", test: 0, index: 9 }),
      RangeError,
    );
    assert.throws(
      () => applyEdit(source, { op: "remove", test: 4, index: 0 }),
      RangeError,
    );
    assert.throws(
      () =>
        applyEdit(source, {
          op: "insert",
          test: 0,
          index: 9,
          step: { kind: "waitForNetworkIdle" },
        }),
      RangeError,
    );
  });

  it("an edited file parses back to the edited steps", () => {
    let next = source;
    next = applyEdit(next, {
      op: "insert",
      test: 0,
      index: 0,
      step: { kind: "waitForNetworkIdle" },
    });
    next = applyEdit(next, { op: "remove", test: 0, index: 2 });
    assert.deepEqual(
      stepsOf(next).map((s) => s.kind),
      ["waitForNetworkIdle", "goto", "custom"],
    );
  });
});

describe("applyEdit and the test's fixtures", () => {
  const field = {
    chain: [{ method: "getByCss" as const, css: "#f" }],
    fallbacks: [],
  };
  const fillWith = (kind: "env" | "secret", name: string): Step => ({
    kind: "fill",
    locator: field,
    value: { kind, name },
  });
  const insert = (source: string, step: Step) =>
    applyEdit(source, { op: "insert", test: 0, index: 0, step });

  it("adds env and secrets to the parameters when a step reads them", () => {
    let next = `test("t", async ({ page }) => {\n});\n`;
    next = insert(next, fillWith("env", "user"));
    next = insert(next, fillWith("secret", "PW"));
    assert.match(next, /^test\("t", async \(\{ page, env, secrets \}\) => \{/);
  });

  it("adds a fixture once, and leaves the parameters alone when it is there", () => {
    const source = `test("t", async ({ page, env }) => {\n});\n`;
    const next = insert(
      insert(source, fillWith("env", "a")),
      fillWith("env", "b"),
    );
    assert.match(next, /async \(\{ page, env \}\)/);
  });

  it("counts a renamed fixture as there", () => {
    const source = `test("t", async ({ page, env: data }) => {\n});\n`;
    assert.match(
      insert(source, fillWith("env", "a")),
      /async \(\{ page, env: data \}\)/,
    );
  });

  it("replace adds the fixture too", () => {
    const source = `test("t", async ({ page }) => {\n  await page.goto("/");\n});\n`;
    const next = applyEdit(source, {
      op: "replace",
      test: 0,
      index: 0,
      step: fillWith("secret", "PW"),
    });
    assert.match(next, /async \(\{ page, secrets \}\)/);
  });

  it("a callback without parameters gets them", () => {
    const next = insert(`test("t", async () => {\n});\n`, fillWith("env", "a"));
    assert.match(next, /async \(\{ env \}\) =>/);
  });

  it("an empty pattern and a trailing comma stay valid", () => {
    assert.match(
      insert(`test("t", async ({}) => {});`, fillWith("env", "a")),
      /async \(\{ env \}\)/,
    );
    assert.match(
      insert(`test("t", async ({ page, }) => {});`, fillWith("env", "a")),
      /async \(\{ page, env, \}\)/,
    );
  });

  it("leaves parameters it can't extend alone", () => {
    for (const params of ["fixtures", "{ page, ...rest }"]) {
      const source = `test("t", async (${params}) => {});`;
      assert.ok(
        insert(source, fillWith("env", "a")).startsWith(source.slice(0, -4)),
      );
    }
  });

  it("the edited test is still found with its steps", () => {
    const next = insert(
      `test("t", async ({ page }) => {\n});\n`,
      fillWith("env", "a"),
    );
    assert.deepEqual(stepsOf(next), [fillWith("env", "a")]);
  });
});
