import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkFlow } from "./check.js";
import { problemOf, scopeAt } from "./expression/index.js";
import { branchNames, branchesOf, dynamicOf, shapeOf } from "./nodes/index.js";
import type { FlowFile } from "./schema.js";
import { stepNodeOf } from "./steps.js";

const setter = stepNodeOf({
  kind: "setter",
  label: "Setter",
  icon: "braces",
  section: "control",
  fields: [
    {
      path: "config.name",
      type: "text",
      label: "Name",
      default: "",
      required: true,
    },
  ],
  writesVar: "config.name",
});
const fetcher = stepNodeOf({
  kind: "fetcher",
  label: "Fetcher",
  icon: "globe",
  section: "integrations",
  fields: [
    { path: "config.url", type: "expression", label: "URL", default: "" },
  ],
  outputs: [{ name: "code" }],
});
const at = (id: string, kind: string, extra: object = {}) => ({
  id,
  key: id,
  kind,
  onFailure: "stop" as const,
  position: { x: 0, y: 0 },
  ...extra,
});
const flow: FlowFile = {
  id: "f",
  name: "f",
  nodes: [
    at("start", "start"),
    at("s", "setter", { config: { name: "order" } }),
    at("f1", "fetcher", { config: { url: '"http://x/" + vars.order' } }),
    at("c", "condition", { config: { expr: "nodes.f1.code == 200" } }),
    at("end", "end"),
  ],
  edges: [
    { id: "1", source: "start", target: "s" },
    { id: "2", source: "s", target: "f1" },
    { id: "3", source: "f1", target: "c" },
    { id: "4", source: "c", target: "end", sourceHandle: "true" },
    { id: "5", source: "c", target: "end", sourceHandle: "false" },
  ],
};
const env = { name: "dev", variables: {} };

describe("kinds core wasn't built with", () => {
  test("are steps without branches", () => {
    assert.equal(shapeOf({ kind: "anything" }), "step");
    assert.equal(dynamicOf({ kind: "anything" }), undefined);
    assert.deepEqual(branchesOf({ kind: "anything" }), []);
    assert.deepEqual(branchNames({ kind: "anything" }), []);
  });

  test("scopeAt learns written variables and outputs from the definitions", () => {
    const scope = scopeAt(flow, "c", env, { nodes: [setter, fetcher] });
    assert.deepEqual(scope.vars, ["order"]);
    assert.deepEqual(scope.outputs, { f1: ["code"] });
    assert.equal(problemOf("nodes.f1.code == 200", scope), undefined);
    assert.equal(
      problemOf("nodes.f1.body", scope)?.message,
      "nodes.f1.body doesn't exist. Use status, durationMs, error or code",
    );
  });

  test("checkFlow with the definitions: clean; without them: unknown steps", () => {
    assert.deepEqual(
      checkFlow(flow, { environment: env, nodes: [setter, fetcher] }),
      [],
    );
    const unknown = checkFlow(flow, { environment: env }).filter((p) =>
      p.message.startsWith("Unknown step"),
    );
    assert.deepEqual(
      unknown.map((p) => p.message),
      ["Unknown step: setter", "Unknown step: fetcher"],
    );
  });

  test("checkFlow applies a step's field rules", () => {
    const empty = {
      ...flow,
      nodes: flow.nodes.map((n) =>
        n.id === "s" ? { ...n, config: { name: "" } } : n,
      ),
    };
    assert.ok(
      checkFlow(empty, { nodes: [setter, fetcher] }).some(
        (p) => p.message === "Setter: Name is required.",
      ),
    );
  });
});
