import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdit } from "./edit.js";
import { stepToSource } from "./emit.js";
import type { Expectation, LocatorSpec, Step } from "./model.js";
import { stepsOf, wrap } from "../testing/spec-source.js";

const field: LocatorSpec = {
  chain: [{ method: "getByLabel", text: "Name" }],
  fallbacks: [],
};

const NO_ARGUMENT = [
  "toBeFocused",
  "toBeDisabled",
  "toBeEditable",
  "toBeAttached",
  "toBeInViewport",
  "toBeEmpty",
] as const;

const WITH_TEXT = [
  "toHaveId",
  "toHaveAccessibleName",
  "toHaveAccessibleDescription",
] as const;

const expectStep = (expectation: Expectation, not = false): Step => ({
  kind: "expect",
  locator: field,
  not,
  expectation,
});

describe("plain matchers", () => {
  it("round-trips the matchers without an argument, with and without not", () => {
    for (const matcher of NO_ARGUMENT)
      for (const not of [false, true]) {
        const step = expectStep({ matcher }, not);
        const code = `await expect(page.getByLabel("Name"))${not ? ".not" : ""}.${matcher}();`;
        assert.equal(stepToSource(step), code);
        assert.deepEqual(stepsOf(wrap(code)), [step]);
      }
  });

  it("round-trips the matchers that take a text or a RegExp", () => {
    for (const matcher of WITH_TEXT)
      for (const [expected, written] of [
        ["x", `"x"`],
        [{ regex: { source: "^a.+z$", flags: "i" } }, "/^a.+z$/i"],
      ] as const)
        for (const not of [false, true]) {
          const step = expectStep({ matcher, expected }, not);
          const code = `await expect(page.getByLabel("Name"))${not ? ".not" : ""}.${matcher}(${written});`;
          assert.equal(stepToSource(step), code);
          assert.deepEqual(stepsOf(wrap(code)), [step]);
        }
  });

  it("keeps calls with options, extra arguments or computed values as custom code", () => {
    for (const code of [
      ...NO_ARGUMENT.flatMap((m) => [
        `await expect(page.getByLabel("Name")).${m}({ timeout: 1 });`,
        `await expect(page.getByLabel("Name")).${m}(true);`,
      ]),
      `await expect(page.getByLabel("Name")).toBeEditable({ editable: false });`,
      `await expect(page.getByLabel("Name")).toBeAttached({ attached: false });`,
      `await expect(page.getByLabel("Name")).toBeInViewport({ ratio: 0.5 });`,
      ...WITH_TEXT.flatMap((m) => [
        `await expect(page.getByLabel("Name")).${m}();`,
        `await expect(page.getByLabel("Name")).${m}(name);`,
        `await expect(page.getByLabel("Name")).${m}("a", { timeout: 1 });`,
        `await expect(page.getByLabel("Name")).${m}("a", { output: "x" });`,
      ]),
      `await expect(page.getByLabel("Name")).toHaveJSProperty("value", { a: 1 });`,
      `await expect(page.getByLabel("Name")).toHaveText(expect.stringContaining("a"));`,
    ])
      assert.equal(stepsOf(wrap(code))[0]!.kind, "custom", code);
  });

  it("can't save an output from the new text matchers", () => {
    const step: Step = {
      kind: "expect",
      locator: field,
      not: false,
      expectation: { matcher: "toHaveId", expected: "x" },
      output: "id",
    };
    assert.throws(
      () =>
        applyEdit(wrap(), {
          op: "insert",
          test: 0,
          index: 0,
          step,
        }),
      /output can't be saved from toHaveId/,
    );
  });

  it("edits leave the other statements byte for byte", () => {
    const source = wrap(
      `// check the field`,
      `await expect( page.getByLabel('Name') ).toBeVisible( );`,
      `await page.getByLabel('Name').fill( 'a' );`,
    );
    const step = expectStep({ matcher: "toBeFocused" });
    const replaced = applyEdit(source, {
      op: "replace",
      test: 0,
      index: 0,
      step,
    });
    assert.equal(
      replaced,
      source.replace(
        `await expect( page.getByLabel('Name') ).toBeVisible( );`,
        stepToSource(step),
      ),
    );
    const inserted = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 1,
      step: expectStep({ matcher: "toHaveId", expected: "name" }),
    });
    assert.ok(
      inserted.includes(`  await page.getByLabel('Name').fill( 'a' );\n`),
    );
    assert.ok(
      inserted.includes(
        `  await expect(page.getByLabel("Name")).toHaveId("name");\n`,
      ),
    );
  });
});
