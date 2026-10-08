import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowNodeModel } from "../schema.js";
import {
  branchesOf,
  branchNames,
  branchOf,
  configDefaults,
  dynamicOf,
  getPath,
  NODES,
  UNSUPPORTED_KINDS,
  nodeDef,
  setPath,
  shapeOf,
  withDefaults,
} from "./index.js";

const KINDS = [
  "start",
  "end",
  "test",
  "group",
  "condition",
  "parallel",
  "wait",
  "set-variable",
  "api",
  "database",
  "email",
  "script",
];

const node = (kind: string, extra: Partial<FlowNodeModel> = {}) =>
  ({
    id: "n1",
    kind,
    onFailure: "stop",
    position: { x: 0, y: 0 },
    ...extra,
  }) as FlowNodeModel;

describe("node registry", () => {
  test("every kind is registered once, in library order", () => {
    assert.deepEqual(
      NODES.map((d) => d.kind),
      KINDS,
    );
    for (const kind of KINDS) assert.equal(nodeDef(kind).kind, kind);
  });

  test("nodeDef throws for an unknown kind", () => {
    assert.throws(() => nodeDef("nope"), /Unknown node kind: nope/);
  });

  test("shapes", () => {
    const shapes = Object.fromEntries(NODES.map((d) => [d.kind, d.shape]));
    assert.deepEqual(shapes, {
      start: "start",
      end: "end",
      test: "step",
      group: "step",
      condition: "branches",
      parallel: "branches",
      wait: "step",
      "set-variable": "step",
      api: "step",
      database: "step",
      email: "step",
      script: "step",
    });
    assert.equal(shapeOf(node("wait")), "step");
  });

  test("field defaults", () => {
    assert.deepEqual(configDefaults(nodeDef("condition")), { expr: "" });
    assert.deepEqual(configDefaults(nodeDef("wait")), { ms: 1000 });
    assert.deepEqual(configDefaults(nodeDef("set-variable")), {
      name: "",
      value: "",
    });
    assert.deepEqual(configDefaults(nodeDef("start")), {});
    assert.deepEqual(withDefaults(nodeDef("wait"), node("wait")).config, {
      ms: 1000,
    });
    assert.deepEqual(
      withDefaults(nodeDef("wait"), node("wait", { config: { ms: 5 } })).config,
      { ms: 5 },
    );
  });

  test("branches", () => {
    assert.deepEqual(branchesOf(node("condition")), [
      { name: "true", label: "true", color: "success" },
      { name: "false", label: "false", color: "error" },
    ]);
    assert.deepEqual(dynamicOf(node("parallel")), { dynamic: true, min: 2 });
    assert.equal(dynamicOf(node("condition")), undefined);
    assert.deepEqual(branchNames(node("parallel")), ["branch-0", "branch-1"]);
    assert.deepEqual(branchNames(node("wait")), []);
    assert.deepEqual(branchOf(node("parallel"), "branch-3"), {
      name: "branch-3",
    });
    assert.equal(branchOf(node("condition"), "true")?.color, "success");
  });

  test("labels, outputs and failure choice", () => {
    assert.deepEqual(
      ["api", "database", "email", "script"].map((k) => nodeDef(k).label),
      ["HTTP request", "Database query", "Email inbox", "Script"],
    );
    assert.equal(nodeDef("test").outputs, true);
    assert.equal(nodeDef("condition").onFailure, true);
    assert.equal(nodeDef("parallel").onFailure, true);
  });

  test("getPath and setPath", () => {
    const n = node("test", {
      title: "Hello",
      ref: { testId: "a::b" },
      config: { expr: "x", other: 1 },
    });
    assert.equal(getPath(n, "title"), "Hello");
    assert.equal(getPath(n, "subtitle"), undefined);
    assert.equal(getPath(n, "config.expr"), "x");
    assert.equal(getPath(n, "ref.testId"), "a::b");
    assert.deepEqual(setPath(n, "title", "Bye"), { title: "Bye" });
    assert.deepEqual(setPath(n, "config.expr", "y"), {
      config: { expr: "y", other: 1 },
    });
  });
});

describe("UNSUPPORTED_KINDS", () => {
  test("lists api, database, email and script, all registered core kinds", () => {
    assert.deepEqual([...UNSUPPORTED_KINDS].sort(), [
      "api",
      "database",
      "email",
      "script",
    ]);
    const kinds = new Set(NODES.map((d) => d.kind));
    for (const k of UNSUPPORTED_KINDS) assert.ok(kinds.has(k), k);
  });
});
