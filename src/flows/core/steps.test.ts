import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowNodeModel } from "./schema.js";
import { fieldProblems, isIoName, stepNodeOf, type StepInfo } from "./steps.js";

const node = (config: Record<string, unknown>): FlowNodeModel => ({
  id: "n",
  kind: "demo",
  onFailure: "stop",
  position: { x: 0, y: 0 },
  config,
});

const info: StepInfo = {
  kind: "demo",
  label: "Demo",
  icon: "globe",
  section: "integrations",
  fields: [
    {
      path: "config.name",
      type: "text",
      label: "Name",
      default: "",
      required: true,
      pattern: "^[a-z]+$",
      patternMessage: "use lowercase letters for the name.",
    },
    {
      path: "config.count",
      type: "number",
      label: "Count",
      default: 1,
      min: 1,
      max: 5,
    },
  ],
  outputs: [{ name: "code" }],
  writesVar: "config.name",
};

describe("fieldProblems", () => {
  test("required, pattern, min and max", () => {
    assert.deepEqual(
      fieldProblems(info.fields, node({ name: "", count: 0 }), "Demo").map(
        (p) => p.message,
      ),
      ["Demo: Name is required.", "Demo: Count must be at least 1."],
    );
    assert.deepEqual(
      fieldProblems(info.fields, node({ name: "A1", count: 9 }), "Demo").map(
        (p) => p.message,
      ),
      [
        "Demo: use lowercase letters for the name.",
        "Demo: Count must be at most 5.",
      ],
    );
    assert.deepEqual(
      fieldProblems(info.fields, node({ name: "ok", count: 3 }), "Demo"),
      [],
    );
  });

  test("a problem names its node", () => {
    const [p] = fieldProblems(info.fields, node({ name: "" }), "Demo");
    assert.deepEqual(p, {
      level: "error",
      nodeId: "n",
      message: "Demo: Name is required.",
    });
  });
});

describe("stepNodeOf", () => {
  test("a step node: shape step, Title and Description first, results and writesVar", () => {
    const def = stepNodeOf(info);
    assert.equal(def.shape, "step");
    assert.equal(def.onFailure, true);
    assert.deepEqual(
      def.fields.map((f) => f.path),
      ["title", "subtitle", "config.name", "config.count"],
    );
    assert.deepEqual(def.results, ["code"]);
    assert.equal(def.writesVar, "config.name");
  });

  test("validate applies field rules (with defaults) then the step's own validate", () => {
    const def = stepNodeOf(info, (n, ctx) => [
      { level: "warning", nodeId: n.id, message: `${ctx.label}: own` },
    ]);
    const problems = def.validate!(
      { ...node({}), config: { name: "", count: 1 } },
      { label: "Demo" },
    );
    assert.deepEqual(
      problems.map((p) => p.message),
      ["Demo: Name is required.", "Demo: own"],
    );
  });
});

describe("isIoName", () => {
  test("takes an identifier that isn't a node's own result field or an object's special key", () => {
    for (const name of ["orderId", "_x", "a1", "A_B"])
      assert.equal(isIoName(name), true, name);
    for (const name of [
      "",
      "1st",
      "order id",
      "a-b",
      "$x",
      "status",
      "durationMs",
      "error",
      "__proto__",
      "constructor",
      "prototype",
    ])
      assert.equal(isIoName(name), false, name);
  });
});
