import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdit } from "./edit.js";
import { parseSpec, parseSpecFile } from "./parse.js";

const RUNTIME = `import { expect, test } from "samurai";

test("purchase", {
  inputs: { email: "a@b.c" },
  outputs: ["orderId", "ref"],
}, async ({ page, inputs, outputs }) => {
  await page.getByLabel("Email").fill(inputs.email);
  await outputs.save("orderId", page.getByTestId("conf"), /Order #(\\d+)/);
  await expect(page.getByTestId("conf")).toHaveText(/Order #(\\d+)/, { output: "orderId" });
  await page.getByLabel("Ref").fill("gen-123", { output: "ref" });
});
`;

const one = (options: string) =>
  `test("t", ${options}async ({ page }) => {\n  await page.goto("/");\n});\n`;

describe("the test() options object", () => {
  it("reads inputs and outputs, and the steps that use them", () => {
    const [test] = parseSpec(RUNTIME);
    assert.deepEqual(test!.inputs, [{ name: "email", default: "a@b.c" }]);
    assert.deepEqual(test!.outputs, ["orderId", "ref"]);
    assert.deepEqual(test!.fixtures?.names, ["page", "inputs", "outputs"]);
    assert.ok(test!.steps.every(({ step }) => step.kind !== "custom"));
  });

  it("reads quoted keys and no-substitution templates, and leaves both keys out without them", () => {
    const [test] = parseSpec(
      one('{ inputs: { "a": `1`, b_2: "" }, outputs: [] }, '),
    );
    assert.deepEqual(test!.inputs, [
      { name: "a", default: "1" },
      { name: "b_2", default: "" },
    ]);
    assert.deepEqual(test!.outputs, []);
    const [plain] = parseSpec(one(""));
    assert.ok(!("inputs" in plain!) && !("outputs" in plain!));
  });

  it("merges reason with inputs and outputs for skip and fixme", () => {
    const tests = parseSpec(
      `test.skip("a", { reason: "later", inputs: { x: "1" } }, async () => {});\n` +
        `test.fixme("b", { outputs: ["y"], reason: "broken" }, async () => {});\n`,
    );
    assert.deepEqual(
      tests.map((t) => [t.modifier, t.reason, t.inputs, t.outputs]),
      [
        ["skip", "later", [{ name: "x", default: "1" }], undefined],
        ["fixme", "broken", undefined, ["y"]],
      ],
    );
  });

  it("makes a test whose options aren't a plain literal unparsed", () => {
    for (const options of [
      "{ inputs: defaults }, ",
      "{ inputs: { a: value } }, ",
      "{ inputs: { ...rest } }, ",
      '{ inputs: { [key]: "1" } }, ',
      "{ outputs: names }, ",
      '{ outputs: ["a", name] }, ',
      "{ outputs: [...names] }, ",
      "{ inputs }, ",
      "{ ...options }, ",
      "{ timeout: 5 }, ",
      "options, ",
    ]) {
      const { tests, unparsed } = parseSpecFile(one(options));
      assert.deepEqual(tests, [], options);
      assert.deepEqual(
        unparsed.map(({ kind, reason }) => ({ kind, reason })),
        [{ kind: "test", reason: "dynamic-options" }],
        options,
      );
    }
  });

  it("a describe takes only a reason", () => {
    const { unparsed } = parseSpecFile(
      'describe.skip("d", { outputs: ["a"] }, () => { test("t", async () => {}); });',
    );
    assert.deepEqual(
      unparsed.map(({ kind, reason }) => ({ kind, reason })),
      [{ kind: "describe", reason: "dynamic-options" }],
    );
  });

  it("an untouched file and a no-op edit round-trip byte-identical", () => {
    const source = `test("t", { inputs: { a: "1" } }, async ({ page, inputs }) => {\n  await page.getByLabel("A").fill(inputs.a);\n});\n`;
    const [test] = parseSpec(source);
    assert.equal(
      applyEdit(source, {
        op: "replace",
        test: 0,
        index: 0,
        step: test!.steps[0]!.step,
      }),
      source,
    );
    assert.equal(
      applyEdit(source, {
        op: "declare",
        test: 0,
        inputs: [{ name: "a", default: "1" }],
      }),
      source,
    );
    assert.equal(
      applyEdit(RUNTIME, {
        op: "declare",
        test: 0,
        inputs: [{ name: "email", default: "a@b.c" }],
        outputs: ["orderId", "ref"],
      }),
      RUNTIME,
    );
  });
});

describe("applyEdit declare", () => {
  const declare = (
    source: string,
    lists: {
      inputs?: { name: string; default: string }[];
      outputs?: string[];
    },
  ) => applyEdit(source, { op: "declare", test: 0, ...lists });

  it("adds the options object after the title", () => {
    assert.equal(
      declare(one(""), {
        inputs: [{ name: "email", default: 'a"b' }],
        outputs: ["orderId"],
      }),
      one('{ inputs: { email: "a\\"b" }, outputs: ["orderId"] }, '),
    );
  });

  it("replaces only the list it is given", () => {
    assert.equal(
      declare(one('{ inputs: { a: "1" }, outputs: ["x"] }, '), {
        outputs: ["x", "y"],
      }),
      one('{ inputs: { a: "1" }, outputs: ["x", "y"] }, '),
    );
    assert.equal(
      declare(one('{ outputs: ["x"] }, '), {
        inputs: [{ name: "b", default: "2" }],
      }),
      one('{ outputs: ["x"], inputs: { b: "2" } }, '),
    );
  });

  it("keeps a multi-line object's layout", () => {
    const next = declare(RUNTIME, {
      outputs: ["orderId"],
      inputs: [
        { name: "email", default: "a@b.c" },
        { name: "pass", default: "pw" },
      ],
    });
    assert.equal(
      next,
      RUNTIME.replace(
        '{ email: "a@b.c" }',
        '{ email: "a@b.c", pass: "pw" }',
      ).replace('["orderId", "ref"]', '["orderId"]'),
    );
    const added = declare(
      'test("t", {\n  inputs: { a: "1" },\n}, async () => {});\n',
      { outputs: ["x"] },
    );
    assert.equal(
      added,
      'test("t", {\n  inputs: { a: "1" },\n  outputs: ["x"],\n}, async () => {});\n',
    );
  });

  it("removes an emptied list, and the object once nothing else is left", () => {
    assert.equal(
      declare(one('{ inputs: { a: "1" }, outputs: ["x"] }, '), {
        inputs: [],
      }),
      one('{ outputs: ["x"] }, '),
    );
    assert.equal(
      declare(one('{ inputs: { a: "1" }, outputs: ["x"] }, '), {
        outputs: [],
      }),
      one('{ inputs: { a: "1" } }, '),
    );
    assert.equal(
      declare(one('{ inputs: { a: "1" }, outputs: ["x"] }, '), {
        inputs: [],
        outputs: [],
      }),
      one(""),
    );
    assert.equal(declare(one(""), { inputs: [], outputs: [] }), one(""));
  });

  it("keeps the reason of a skip or fixme", () => {
    const skip = (options: string) =>
      `test.skip("t", ${options}async () => {});\n`;
    assert.equal(
      declare(skip('{ reason: "later" }, '), { outputs: ["x"] }),
      skip('{ reason: "later", outputs: ["x"] }, '),
    );
    assert.equal(
      declare(skip('{ reason: "later", outputs: ["x"] }, '), { outputs: [] }),
      skip('{ reason: "later" }, '),
    );
    assert.equal(
      declare(skip('{ outputs: ["x"], reason: "later" }, '), { outputs: [] }),
      skip('{ reason: "later" }, '),
    );
  });

  it("is read back by the parser", () => {
    const next = declare(one(""), {
      inputs: [{ name: "a", default: "1" }],
      outputs: ["b"],
    });
    const [test] = parseSpec(next);
    assert.deepEqual(test!.inputs, [{ name: "a", default: "1" }]);
    assert.deepEqual(test!.outputs, ["b"]);
  });
});
