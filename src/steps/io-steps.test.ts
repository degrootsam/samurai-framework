import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdit } from "./edit.js";
import { stepToSource } from "./emit.js";
import type { LocatorSpec, Step } from "./model.js";
import { parseSpec } from "./parse.js";

const conf: LocatorSpec = {
  chain: [{ method: "getByTestId", testId: "conf" }],
  fallbacks: [],
};

const spec = (options: string, params: string, ...lines: string[]) =>
  `import { expect, test } from "samurai";\n\ntest("t", ${options}async (${params}) => {\n${lines.map((l) => `  ${l}\n`).join("")}});\n`;

const SAMPLES: [Step, string][] = [
  [
    { kind: "saveOutput", name: "orderId", locator: conf },
    'await outputs.save("orderId", page.getByTestId("conf"));',
  ],
  [
    {
      kind: "saveOutput",
      name: "orderId",
      locator: conf,
      pattern: { source: "Order #(\\d+)", flags: "i" },
    },
    'await outputs.save("orderId", page.getByTestId("conf"), /Order #(\\d+)/i);',
  ],
  [
    {
      kind: "fill",
      locator: conf,
      value: { kind: "literal", value: "gen-123" },
      output: "ref",
    },
    'await page.getByTestId("conf").fill("gen-123", { output: "ref" });',
  ],
  [
    { kind: "fill", locator: conf, value: { kind: "input", name: "email" } },
    'await page.getByTestId("conf").fill(inputs.email);',
  ],
  [
    {
      kind: "expect",
      locator: conf,
      not: false,
      expectation: {
        matcher: "toHaveText",
        expected: { regex: { source: "Order #(\\d+)", flags: "" } },
      },
      output: "orderId",
    },
    'await expect(page.getByTestId("conf")).toHaveText(/Order #(\\d+)/, { output: "orderId" });',
  ],
  [
    {
      kind: "expect",
      locator: conf,
      not: false,
      expectation: { matcher: "toContainText", expected: "Order" },
      output: "a",
    },
    'await expect(page.getByTestId("conf")).toContainText("Order", { output: "a" });',
  ],
  [
    {
      kind: "expect",
      locator: conf,
      not: false,
      expectation: { matcher: "toHaveValue", expected: "x" },
      output: "v",
    },
    'await expect(page.getByTestId("conf")).toHaveValue("x", { output: "v" });',
  ],
  [
    {
      kind: "expect",
      locator: conf,
      not: false,
      expectation: { matcher: "toHaveAttribute", name: "href", expected: "/x" },
      output: "link",
    },
    'await expect(page.getByTestId("conf")).toHaveAttribute("href", "/x", { output: "link" });',
  ],
];

const stepsIn = (source: string) =>
  parseSpec(source)[0]!.steps.map(({ step }) => step);

describe("steps that read inputs and save outputs", () => {
  it("emit as the runtime writes them and parse back to the same step", () => {
    for (const [step, code] of SAMPLES) {
      assert.equal(stepToSource(step), code);
      assert.deepEqual(stepsIn(spec("", "{ page }", code)), [step], code);
    }
  });

  it("escapes a / in a pattern, so the spec compiles and parses back to the step", () => {
    const save = (source: string): Step => ({
      kind: "saveOutput",
      name: "orderId",
      locator: conf,
      pattern: { source, flags: "" },
    });
    const check = (source: string): Step => ({
      kind: "expect",
      locator: conf,
      not: false,
      expectation: {
        matcher: "toHaveText",
        expected: { regex: { source, flags: "" } },
      },
    });
    for (const [raw, code] of [
      [
        save("orders/(\\d+)"),
        'await outputs.save("orderId", page.getByTestId("conf"), /orders\\/(\\d+)/);',
      ],
      [
        check("orders/(\\d+)"),
        'await expect(page.getByTestId("conf")).toHaveText(/orders\\/(\\d+)/);',
      ],
    ] as const) {
      assert.equal(stepToSource(raw), code);
      const escaped =
        raw.kind === "saveOutput"
          ? save("orders\\/(\\d+)")
          : check("orders\\/(\\d+)");
      assert.deepEqual(stepsIn(spec("", "{ page }", code)), [escaped], code);
      // Already escaped text is left alone
      assert.equal(stepToSource(escaped), code);
    }
    const next = applyEdit(spec("", "{ page }"), {
      op: "insert",
      test: 0,
      index: 0,
      step: save("orders/(\\d+)"),
    });
    assert.deepEqual(stepsIn(next), [save("orders\\/(\\d+)")]);
  });

  it('reads inputs["name"] as an input', () => {
    assert.deepEqual(
      stepsIn(
        spec(
          "",
          "{ page }",
          'await page.getByTestId("conf").fill(inputs["email"]);',
        ),
      ),
      [
        {
          kind: "fill",
          locator: conf,
          value: { kind: "input", name: "email" },
        },
      ],
    );
  });

  it("keeps the shapes that can't save an output as custom", () => {
    for (const code of [
      'await expect(page.getByTestId("conf")).not.toHaveText("x", { output: "a" });',
      'await expect(page.getByTestId("conf")).toBeVisible({ output: "a" });',
      'await expect(page.getByTestId("conf")).toHaveClass("x", { output: "a" });',
      'await expect(page.getByTestId("conf")).toHaveText("x", { output: name });',
      'await expect(page.getByTestId("conf")).toHaveText("x", { output: "a", timeout: 5 });',
      'await page.getByTestId("conf").fill("x", { output: "a", force: true });',
      'await outputs.save("a", page.getByTestId("conf"), "Order");',
      'await outputs.save(name, page.getByTestId("conf"));',
      'await outputs.save("a");',
      'await outputs.save("a", page.getByTestId("conf"), /x/, 1);',
      'await other.save("a", page.getByTestId("conf"));',
    ]) {
      assert.deepEqual(stepsIn(spec("", "{ page }", code)), [
        { kind: "custom", code },
      ]);
    }
  });
});

describe("applyEdit with inputs and outputs", () => {
  it("insert of a saveOutput declares the output and adds the outputs fixture", () => {
    const source = spec("", "{ page }", 'await page.goto("/");');
    const next = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 1,
      step: SAMPLES[0]![0],
    });
    assert.equal(
      next,
      spec(
        '{ outputs: ["orderId"] }, ',
        "{ page, outputs }",
        'await page.goto("/");',
        SAMPLES[0]![1],
      ),
    );
    assert.deepEqual(parseSpec(next)[0]!.outputs, ["orderId"]);
  });

  it("adds a missing output to an existing list, and leaves a declared one alone", () => {
    const source = spec(
      '{ inputs: { email: "a@b.c" }, outputs: ["x"] }, ',
      "{ page, outputs }",
    );
    const fill = SAMPLES[2]![0];
    const next = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 0,
      step: fill,
    });
    assert.equal(
      next,
      spec(
        '{ inputs: { email: "a@b.c" }, outputs: ["x", "ref"] }, ',
        "{ page, outputs }",
        SAMPLES[2]![1],
      ),
    );
    const again = applyEdit(next, {
      op: "replace",
      test: 0,
      index: 0,
      step: fill,
    });
    assert.equal(again, next);
  });

  it("a check that saves an output declares it, without the outputs fixture", () => {
    const source = spec("", "{ page }", 'await page.goto("/");');
    const next = applyEdit(source, {
      op: "replace",
      test: 0,
      index: 0,
      step: SAMPLES[4]![0],
    });
    assert.equal(
      next,
      spec('{ outputs: ["orderId"] }, ', "{ page }", SAMPLES[4]![1]),
    );
  });

  it("refuses a step that reads an undeclared input, and takes it once declared", () => {
    const source = spec(
      "",
      "{ page }",
      'await page.getByTestId("conf").fill("x");',
    );
    const step: Step = {
      kind: "fill",
      locator: conf,
      value: { kind: "input", name: "a" },
    };
    assert.throws(
      () => applyEdit(source, { op: "replace", test: 0, index: 0, step }),
      { message: 'applyEdit(): input "a" is not declared' },
    );
    assert.throws(
      () => applyEdit(source, { op: "insert", test: 0, index: 0, step }),
      { message: 'applyEdit(): input "a" is not declared' },
    );
    const declared = applyEdit(source, {
      op: "declare",
      test: 0,
      inputs: [{ name: "a", default: "1" }],
    });
    const next = applyEdit(declared, {
      op: "replace",
      test: 0,
      index: 0,
      step,
    });
    assert.equal(
      next,
      spec(
        '{ inputs: { a: "1" } }, ',
        "{ page, inputs }",
        'await page.getByTestId("conf").fill(inputs.a);',
      ),
    );
  });

  it("refuses an output on a negated check or a matcher that can't save one, before writing", () => {
    const source = spec("", "{ page }", 'await page.goto("/");');
    const negated: Step = {
      kind: "expect",
      locator: conf,
      not: true,
      expectation: { matcher: "toHaveText", expected: "x" },
      output: "a",
    };
    const classCheck: Step = {
      kind: "expect",
      locator: conf,
      not: false,
      expectation: { matcher: "toHaveClass", expected: "x" },
      output: "a",
    };
    for (const op of ["insert", "replace"] as const) {
      assert.throws(
        () => applyEdit(source, { op, test: 0, index: 0, step: negated }),
        { message: "applyEdit(): output can't be saved from a negated check" },
      );
      assert.throws(
        () => applyEdit(source, { op, test: 0, index: 0, step: classCheck }),
        { message: "applyEdit(): output can't be saved from toHaveClass" },
      );
    }
  });

  it("refuses an output name the runtime rejects", () => {
    const source = spec("", "{ page }", 'await page.goto("/");');
    for (const name of ["status", "1st", "has-dash"]) {
      assert.throws(
        () =>
          applyEdit(source, {
            op: "insert",
            test: 0,
            index: 0,
            step: { kind: "saveOutput", name, locator: conf },
          }),
        { message: `applyEdit(): output "${name}" is not a valid name` },
      );
    }
  });
});
