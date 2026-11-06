import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdit } from "./edit.js";
import { parseSpec } from "./parse.js";

const PLAN = { type: "plan", description: "plans/pay.plan.md" };
const BODY = 'async ({ page }) => {\n  await page.goto("/");\n});\n';
const one = (options: string) => `test("t", ${options}${BODY}`;

describe("annotations in the test() options object", () => {
  it("reads them, leaves an empty list out, and keeps the steps", () => {
    const [test] = parseSpec(
      one(
        '{ annotations: [{ type: "plan", description: "plans/pay.plan.md" }, { type: "issue" }] }, ',
      ),
    );
    assert.deepEqual(test!.annotations, [PLAN, { type: "issue" }]);
    assert.equal(test!.steps.length, 1);
    const [empty] = parseSpec(one("{ annotations: [] }, "));
    assert.ok(!("annotations" in empty!));
  });

  it("reads them next to inputs, outputs and a reason", () => {
    const [test] = parseSpec(
      `test.skip("t", { reason: "later", inputs: { a: "1" }, annotations: [{ type: "x" }] }, ${BODY}`,
    );
    assert.deepEqual(test!.annotations, [{ type: "x" }]);
    assert.deepEqual(test!.inputs, [{ name: "a", default: "1" }]);
  });

  it("leaves a call unparsed when an annotation is not a plain literal", () => {
    for (const options of [
      "{ annotations: notes }, ",
      "{ annotations: [note] }, ",
      '{ annotations: [{ type: "a", extra: "b" }] }, ',
      "{ annotations: [{ type: `a${1}` }] }, ",
      '{ annotations: [{ description: "no type" }] }, ',
    ])
      assert.equal(parseSpec(one(options)).length, 0, options);
  });

  it("an edit to a step keeps the options, byte for byte", () => {
    const source = one(
      '{ annotations: [ { type: "plan", description: "p" } ] }, ',
    );
    const next = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 1,
      step: { kind: "goto", url: "/two" } as never,
    });
    assert.ok(
      next.includes(
        '{ annotations: [ { type: "plan", description: "p" } ] }, ',
      ),
    );
    assert.equal(
      applyEdit(source, {
        op: "declare",
        test: 0,
        annotations: [{ type: "plan", description: "p" }],
      }),
      source,
    );
  });

  it("declare adds the option to a test without options", () => {
    const next = applyEdit(one(""), {
      op: "declare",
      test: 0,
      annotations: [PLAN],
    });
    assert.equal(
      next,
      one(
        '{ annotations: [{ type: "plan", description: "plans/pay.plan.md" }] }, ',
      ),
    );
    assert.deepEqual(parseSpec(next)[0]!.annotations, [PLAN]);
  });

  it("declare adds to, replaces in and removes from an existing object", () => {
    const withIo = one('{ inputs: { a: "1" } }, ');
    const added = applyEdit(withIo, {
      op: "declare",
      test: 0,
      annotations: [{ type: "x" }],
    });
    assert.ok(
      added.includes('{ inputs: { a: "1" }, annotations: [{ type: "x" }] }'),
    );
    const replaced = applyEdit(added, {
      op: "declare",
      test: 0,
      annotations: [{ type: "y", description: "d" }],
    });
    assert.ok(
      replaced.includes('annotations: [{ type: "y", description: "d" }]'),
    );
    const removed = applyEdit(replaced, {
      op: "declare",
      test: 0,
      annotations: [],
    });
    assert.equal(removed, withIo);
    assert.equal(
      applyEdit(one('{ annotations: [{ type: "x" }] }, '), {
        op: "declare",
        test: 0,
        annotations: [],
      }),
      one(""),
    );
  });

  it("declare refuses an annotation without a type", () => {
    assert.throws(
      () =>
        applyEdit(one(""), {
          op: "declare",
          test: 0,
          annotations: [{ type: "" }],
        }),
      /applyEdit\(\): an annotation needs a non-empty type/,
    );
  });
});
