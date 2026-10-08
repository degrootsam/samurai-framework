import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowFile } from "./schema.js";
import { ancestors, dominates, meetOf, reachOrder } from "./graph.js";

const node = (id: string, kind = "test") => ({
  id,
  kind,
  onFailure: "stop" as const,
  position: { x: 0, y: 0 },
});
const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}-${sourceHandle ?? ""}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});
// start → cond → (true: a) / (false: b) → c → end
const flow: FlowFile = {
  id: "f",
  name: "f",
  nodes: [
    node("start", "start"),
    node("cond", "condition"),
    node("a"),
    node("b"),
    node("c"),
    node("end", "end"),
  ],
  edges: [
    edge("start", "cond"),
    edge("cond", "a", "true"),
    edge("cond", "b", "false"),
    edge("a", "c"),
    edge("b", "c"),
    edge("c", "end"),
  ],
};

describe("graph", () => {
  test("reachOrder walks depth first from a node", () => {
    assert.deepEqual(reachOrder(flow, "cond"), ["cond", "a", "c", "end", "b"]);
  });
  test("meetOf finds where a node's branches meet", () => {
    assert.equal(meetOf(flow, "cond"), "c");
  });
  test("ancestors are every node with a path to the node", () => {
    assert.deepEqual([...ancestors(flow, "c")].sort(), [
      "a",
      "b",
      "cond",
      "start",
    ]);
    assert.deepEqual([...ancestors(flow, "a")].sort(), ["cond", "start"]);
  });
  test("dominates: on every path from Start", () => {
    assert.equal(dominates(flow, "cond", "c"), true);
    assert.equal(dominates(flow, "a", "c"), false);
  });
});
