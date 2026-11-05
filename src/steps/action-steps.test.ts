import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdit } from "./edit.js";
import { stepToSource } from "./emit.js";
import type { LocatorSpec, SelectChoice, Step } from "./model.js";
import { parseSpec } from "./parse.js";
import { stepsOf, wrap } from "../testing/spec-source.js";

const box: LocatorSpec = {
  chain: [{ method: "getByLabel", text: "Agree" }],
  fallbacks: [],
};

const ACTIONS = ["check", "uncheck", "hover", "dblclick", "clear"] as const;

const CHOICES: [SelectChoice, string][] = [
  ["nl", `"nl"`],
  ["", `""`],
  [{ value: "nl" }, `{ value: "nl" }`],
  [{ label: "The Netherlands" }, `{ label: "The Netherlands" }`],
  [{ index: 0 }, `{ index: 0 }`],
  [{ index: 12 }, `{ index: 12 }`],
  [{ value: 'say "hi"' }, `{ value: "say \\"hi\\"" }`],
];

describe("action steps", () => {
  it("round-trips check, uncheck, hover, dblclick and clear", () => {
    for (const kind of ACTIONS) {
      const step: Step = { kind, locator: box };
      const code = `await page.getByLabel("Agree").${kind}();`;
      assert.equal(
        stepToSource(step),
        `await page.getByLabel("Agree").${kind}();`,
      );
      assert.deepEqual(stepsOf(wrap(code)), [step]);
    }
  });

  it("round-trips selectOption with a value, a label, an index or one string", () => {
    for (const [option, written] of CHOICES) {
      const step: Step = { kind: "selectOption", locator: box, option };
      const code = `await page.getByLabel("Agree").selectOption(${written});`;
      assert.equal(stepToSource(step), code);
      assert.deepEqual(stepsOf(wrap(code)), [step], code);
    }
  });

  it("works with chains, fallbacks and the new locator forms", () => {
    const locator: LocatorSpec = {
      chain: [
        { method: "getByRole", role: "row" },
        { method: "filter", hasText: "Ann" },
        { method: "getByRole", role: "checkbox", checked: false },
      ],
      fallbacks: [[{ method: "getByCss", css: "input" }, { method: "first" }]],
    };
    for (const kind of ACTIONS) {
      const step: Step = { kind, locator };
      assert.deepEqual(stepsOf(wrap(stepToSource(step))), [step]);
    }
  });

  it("keeps a press with a chord as it is", () => {
    for (const key of ["Control+a", "Shift+Tab", "ControlOrMeta+Enter", "a"]) {
      const step: Step = { kind: "press", locator: box, key };
      const code = `await page.getByLabel("Agree").press(${JSON.stringify(key)});`;
      assert.equal(stepToSource(step), code);
      assert.deepEqual(stepsOf(wrap(code)), [step]);
    }
  });

  it("keeps everything else on these methods as custom code", () => {
    for (const code of [
      `await page.getByLabel("A").check({ force: true });`,
      `await page.getByLabel("A").uncheck({ timeout: 1 });`,
      `await page.getByLabel("A").hover({ position: { x: 1, y: 1 } });`,
      `await page.getByLabel("A").dblclick({ delay: 5 });`,
      `await page.getByLabel("A").clear({ timeout: 1 });`,
      `await page.getByLabel("A").check(true);`,
      `await page.getByLabel("A").setChecked(true);`,
      `await page.getByLabel("A").selectOption();`,
      `await page.getByLabel("A").selectOption(["a", "b"]);`,
      `await page.getByLabel("A").selectOption([]);`,
      `await page.getByLabel("A").selectOption("a", { timeout: 1 });`,
      `await page.getByLabel("A").selectOption(choice);`,
      `await page.getByLabel("A").selectOption({ value: "a", label: "b" });`,
      `await page.getByLabel("A").selectOption({});`,
      `await page.getByLabel("A").selectOption({ value: 1 });`,
      `await page.getByLabel("A").selectOption({ index: -1 });`,
      `await page.getByLabel("A").selectOption({ index: 1.5 });`,
      `await page.getByLabel("A").selectOption({ other: "a" });`,
      `await page.getByLabel("A").pressSequentially("abc");`,
      `await page.keyboard.press("Enter");`,
      // a test.step holds statements of its own, which the flat step list can't carry
      `await test.step("sign in", async () => { await page.goto("/"); });`,
      `await page.getByLabel("A").press("Enter", { delay: 10 });`,
      `const picked = await page.getByLabel("A").selectOption("a");`,
    ])
      assert.equal(stepsOf(wrap(code))[0]!.kind, "custom", code);
  });
});

describe("editing with the action steps", () => {
  const source = wrap(
    "// open the form",
    `await page.goto( '/form' );`,
    `await page.getByLabel('Agree').click({ force: true });`,
    `const x    = 1;`,
    `await page.getByLabel("Name").fill("a");`,
  );
  const untouched = [
    "// open the form",
    `await page.goto( '/form' );`,
    `await page.getByLabel('Agree').click({ force: true });`,
    `const x    = 1;`,
    `await page.getByLabel("Name").fill("a");`,
  ];
  const lines = (text: string) => text.split("\n").map((line) => line.trim());

  it("inserts a new action between statements and leaves the others byte for byte", () => {
    for (const step of [
      { kind: "check", locator: box },
      { kind: "selectOption", locator: box, option: { value: "nl" } },
    ] satisfies Step[]) {
      const next = applyEdit(source, { op: "insert", test: 0, index: 1, step });
      const expected = stepToSource(step);
      assert.equal(
        next,
        source.replace(
          `  await page.getByLabel('Agree')`,
          `  ${expected}\n  await page.getByLabel('Agree')`,
        ),
      );
      assert.deepEqual(
        parseSpec(next)[0]!
          .steps.map((s) => s.step)
          .slice(1, 2),
        [step],
      );
    }
  });

  it("replaces a custom statement with a typed one, touching only that line", () => {
    const step: Step = { kind: "hover", locator: box };
    const next = applyEdit(source, { op: "replace", test: 0, index: 1, step });
    assert.equal(
      next,
      source.replace(
        `await page.getByLabel('Agree').click({ force: true });`,
        stepToSource(step),
      ),
    );
  });

  it("replaces one action with another, removes it and moves it", () => {
    const text = wrap(
      `await page.getByLabel("Agree").check();`,
      `await page.getByLabel("Agree").click({ force: true });`,
      `const x    = 1;`,
    );
    const swapped = applyEdit(text, {
      op: "replace",
      test: 0,
      index: 0,
      step: { kind: "uncheck", locator: box },
    });
    assert.equal(swapped, text.replace(".check();", ".uncheck();"));
    const removed = applyEdit(text, { op: "remove", test: 0, index: 0 });
    assert.equal(
      removed,
      text.replace(`  await page.getByLabel("Agree").check();\n`, ""),
    );
    const moved = applyEdit(text, { op: "move", test: 0, from: 0, to: 2 });
    assert.deepEqual(lines(moved).slice(3, 6), [
      `await page.getByLabel("Agree").click({ force: true });`,
      `const x    = 1;`,
      `await page.getByLabel("Agree").check();`,
    ]);
  });

  it("leaves the untouched statements as they were", () => {
    const next = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 4,
      step: { kind: "clear", locator: box },
    });
    for (const line of untouched) assert.ok(next.includes(line), line);
  });
});
