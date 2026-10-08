import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowFile } from "../schema.js";
import { scopeAt } from "./scope.js";

const node = (id: string, kind = "test", config?: Record<string, unknown>) => ({
  id,
  key: id,
  kind,
  onFailure: "stop" as const,
  position: { x: 0, y: 0 },
  ...(config ? { config } : {}),
});
const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});
// start → setA(vars.a) → cond → (true: setB(vars.b) → t1) / (false: t2) → join → end
const flow: FlowFile = {
  id: "f",
  name: "f",
  nodes: [
    node("start", "start"),
    node("seta", "set-variable", { name: "a", value: "1" }),
    node("cond", "condition"),
    node("setb", "set-variable", { name: "b", value: "2" }),
    node("t1"),
    node("t2"),
    node("join"),
    node("end", "end"),
  ],
  edges: [
    edge("start", "seta"),
    edge("seta", "cond"),
    edge("cond", "setb", "true"),
    edge("cond", "t2", "false"),
    edge("setb", "t1"),
    edge("t1", "join"),
    edge("t2", "join"),
    edge("join", "end"),
  ],
};
const env = { name: "staging", variables: { region: "eu" } };

describe("scopeAt", () => {
  test("after the branches meet: every earlier node, only variables set on every path", () => {
    const s = scopeAt(flow, "join", env);
    assert.deepEqual(s.before.sort(), [
      "cond",
      "seta",
      "setb",
      "start",
      "t1",
      "t2",
    ]);
    assert.deepEqual(s.vars, ["a"]);
    assert.deepEqual(s.after, ["end"]);
    assert.deepEqual(s.env, { name: "staging", variables: ["region"] });
  });
  test("inside a branch: the other branch is neither before nor after", () => {
    const s = scopeAt(flow, "t1", env);
    assert.ok(!s.before.includes("t2"));
    assert.ok(!s.after.includes("t2"));
    assert.deepEqual(s.vars.sort(), ["a", "b"]);
  });
});
