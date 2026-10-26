import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowFile, FlowNodeModel } from "./schema.js";
import {
  alwaysBefore,
  flowFactsFrom,
  wiringAt,
  type FlowFacts,
} from "./wiring.js";

const node = (
  id: string,
  kind = "test",
  extra: Partial<FlowNodeModel> = {},
): FlowNodeModel => ({
  id,
  key: id,
  kind,
  onFailure: "stop",
  position: { x: 0, y: 0 },
  ...(kind === "test" ? { ref: { testId: id } } : {}),
  ...extra,
});
const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}-${sourceHandle ?? ""}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});
const flowOf = (
  nodes: FlowNodeModel[],
  edges: ReturnType<typeof edge>[],
): FlowFile => ({ id: "f", name: "f", nodes, edges });

/** start → ...ids → end */
const line = (...nodes: FlowNodeModel[]): FlowFile => {
  const all = [node("start", "start"), ...nodes, node("end", "end")];
  return flowOf(
    all,
    all.slice(1).map((n, i) => edge(all[i]!.id, n.id)),
  );
};

const facts: FlowFacts = {
  tests: {
    a: { inputs: [], outputs: ["o"] },
    a2: { inputs: [], outputs: ["o"] },
    b: { inputs: [{ name: "o", default: "fallback" }], outputs: [] },
    p: { inputs: [], outputs: ["o"] },
    q: { inputs: [], outputs: ["o"] },
    g1: { inputs: [{ name: "o", default: "one" }], outputs: [] },
    g2: {
      inputs: [
        { name: "o", default: "two" },
        { name: "x", default: "ex" },
      ],
      outputs: [],
    },
  },
  groups: { both: ["g1", "g2"] },
};

// start → cond → (true: p) / (false: q) → b → end
const conditionFlow = flowOf(
  [
    node("start", "start"),
    node("a"),
    node("cond", "condition"),
    node("p"),
    node("q", "test", { ref: { testId: "none" } }),
    node("b"),
    node("end", "end"),
  ],
  [
    edge("start", "a"),
    edge("a", "cond"),
    edge("cond", "p", "true"),
    edge("cond", "q", "false"),
    edge("p", "b"),
    edge("q", "b"),
    edge("b", "end"),
  ],
);

// start → par → (branch-0: p → w) / (branch-1: q2) → b → end
const parallelFlow = (q2TestId: string) =>
  flowOf(
    [
      node("start", "start"),
      node("par", "parallel"),
      node("p"),
      node("w", "wait"),
      node("q2", "test", { ref: { testId: q2TestId } }),
      node("b"),
      node("end", "end"),
    ],
    [
      edge("start", "par"),
      edge("par", "p", "branch-0"),
      edge("par", "q2", "branch-1"),
      edge("p", "w"),
      edge("w", "b"),
      edge("q2", "b"),
      edge("b", "end"),
    ],
  );

describe("alwaysBefore", () => {
  test("a dominator always ran before", () => {
    const flow = line(node("a"), node("b"));
    assert.equal(alwaysBefore(flow, "a", "b"), true);
    assert.equal(alwaysBefore(flow, "b", "a"), false);
    assert.equal(alwaysBefore(flow, "a", "a"), false);
  });
  test("a node on one Condition arm did not always run", () => {
    assert.equal(alwaysBefore(conditionFlow, "p", "b"), false);
    assert.equal(alwaysBefore(conditionFlow, "a", "b"), true);
  });
  test("a node on a Parallel branch always ran before the nodes after the meet", () => {
    const flow = parallelFlow("none");
    assert.equal(alwaysBefore(flow, "p", "b"), true);
    assert.equal(alwaysBefore(flow, "p", "end"), true);
    assert.equal(alwaysBefore(flow, "p", "q2"), false);
  });
});

describe("wiringAt", () => {
  test("linear A(out o) → B(in o): node A", () => {
    const flow = line(node("a"), node("b"));
    assert.deepEqual(wiringAt(flow, "b", { facts }), {
      o: { from: "node", nodeId: "a", output: "o" },
    });
  });
  test("a malformed input entry is wired by name, not read", () => {
    for (const bad of ["oops", null, { expression: 1 }])
      assert.deepEqual(
        wiringAt(
          line(
            node("a"),
            node("b", "test", {
              inputs: { o: bad } as unknown as FlowNodeModel["inputs"],
            }),
          ),
          "b",
          { facts },
        ),
        { o: { from: "node", nodeId: "a", output: "o" } },
      );
  });
  test("A → A2 → B: the later producer wins", () => {
    const flow = line(node("a"), node("a2"), node("b"));
    assert.deepEqual(wiringAt(flow, "b", { facts }), {
      o: { from: "node", nodeId: "a2", output: "o" },
    });
  });
  test("a producer on one Condition arm is none (Review Focus 3)", () => {
    const flow: FlowFile = {
      ...conditionFlow,
      nodes: conditionFlow.nodes.filter((n) => n.id !== "a"),
      edges: [
        edge("start", "cond"),
        ...conditionFlow.edges.filter(
          (e) => e.source !== "start" && e.source !== "a",
        ),
      ],
    };
    assert.deepEqual(wiringAt(flow, "b", { facts }), {
      o: { from: "none" },
    });
  });
  test("a producer before the Condition is node", () => {
    assert.deepEqual(wiringAt(conditionFlow, "b", { facts }), {
      o: { from: "node", nodeId: "a", output: "o" },
    });
  });
  test("a producer inside a Parallel branch feeds a node after the meet", () => {
    assert.deepEqual(wiringAt(parallelFlow("none"), "b", { facts }), {
      o: { from: "node", nodeId: "p", output: "o" },
    });
  });
  test("an override beats a node; useDefault gives the default", () => {
    const over = line(
      node("a"),
      node("b", "test", { inputs: { o: { expression: '"x"' } } }),
    );
    assert.deepEqual(wiringAt(over, "b", { facts }), {
      o: { from: "expression", expression: '"x"' },
    });
    const byDefault = line(
      node("a"),
      node("b", "test", { inputs: { o: { useDefault: true } } }),
    );
    assert.deepEqual(wiringAt(byDefault, "b", { facts }), {
      o: { from: "default", value: "fallback" },
    });
  });
  test("a group's inputs are its tests' inputs, the first default wins", () => {
    const flow = line(
      node("g", "group", {
        ref: { group: "both" },
        inputs: { o: { useDefault: true }, x: { useDefault: true } },
      }),
    );
    assert.deepEqual(wiringAt(flow, "g", { facts }), {
      o: { from: "default", value: "one" },
      x: { from: "default", value: "ex" },
    });
  });
  test("a group node ignores an expression: it is wired by name", () => {
    const flow = line(
      node("a"),
      node("g", "group", {
        ref: { group: "both" },
        inputs: { o: { expression: '"x"' } },
      }),
    );
    assert.deepEqual(wiringAt(flow, "g", { facts }).o, {
      from: "node",
      nodeId: "a",
      output: "o",
    });
  });
  test("without facts, or for an unknown test, there is nothing to wire", () => {
    const flow = line(node("a"), node("b"));
    assert.deepEqual(wiringAt(flow, "b", {}), {});
    assert.deepEqual(
      wiringAt(line(node("z", "test", { ref: { testId: "gone" } })), "z", {
        facts,
      }),
      {},
    );
  });
  test("a producer inside a nested Parallel feeds a node after the outer meet", () => {
    // start → P → (branch-0: Q → (a | y) → m1; branch-1: z) → b
    const flow = flowOf(
      [
        node("start", "start"),
        node("P", "parallel"),
        node("Q", "parallel"),
        node("a"),
        node("y", "wait"),
        node("m1", "wait"),
        node("z", "wait"),
        node("b"),
        node("end", "end"),
      ],
      [
        edge("start", "P"),
        edge("P", "Q", "branch-0"),
        edge("P", "z", "branch-1"),
        edge("Q", "a", "branch-0"),
        edge("Q", "y", "branch-1"),
        edge("a", "m1"),
        edge("y", "m1"),
        edge("m1", "b"),
        edge("z", "b"),
        edge("b", "end"),
      ],
    );
    assert.equal(alwaysBefore(flow, "a", "b"), true);
    assert.deepEqual(wiringAt(flow, "b", { facts }), {
      o: { from: "node", nodeId: "a", output: "o" },
    });
  });
  test("a producer on one arm of a Condition inside a Parallel branch is none", () => {
    // start → P → (branch-0: C → (true: a | false: y) → m1; branch-1: z) → b
    const flow = flowOf(
      [
        node("start", "start"),
        node("P", "parallel"),
        node("C", "condition"),
        node("a"),
        node("y", "wait"),
        node("m1", "wait"),
        node("z", "wait"),
        node("b"),
        node("end", "end"),
      ],
      [
        edge("start", "P"),
        edge("P", "C", "branch-0"),
        edge("P", "z", "branch-1"),
        edge("C", "a", "true"),
        edge("C", "y", "false"),
        edge("a", "m1"),
        edge("y", "m1"),
        edge("m1", "b"),
        edge("z", "b"),
        edge("b", "end"),
      ],
    );
    assert.equal(alwaysBefore(flow, "a", "b"), false);
    assert.deepEqual(wiringAt(flow, "b", { facts }), { o: { from: "none" } });
  });
  test("three levels of Parallels, in either node order: wired to the innermost producer", () => {
    // start → R → (P → (Q → (a | y) → m1 | z) → m2 | w) → mR → b
    const nodes = [
      node("start", "start"),
      node("R", "parallel"),
      node("P", "parallel"),
      node("Q", "parallel"),
      node("a"),
      node("y", "wait"),
      node("m1", "wait"),
      node("z", "wait"),
      node("m2", "wait"),
      node("w", "wait"),
      node("mR", "wait"),
      node("b"),
      node("end", "end"),
    ];
    const edges = [
      edge("start", "R"),
      edge("R", "P", "branch-0"),
      edge("R", "w", "branch-1"),
      edge("P", "Q", "branch-0"),
      edge("P", "z", "branch-1"),
      edge("Q", "a", "branch-0"),
      edge("Q", "y", "branch-1"),
      edge("a", "m1"),
      edge("y", "m1"),
      edge("m1", "m2"),
      edge("z", "m2"),
      edge("m2", "mR"),
      edge("w", "mR"),
      edge("mR", "b"),
      edge("b", "end"),
    ];
    for (const flow of [
      flowOf(nodes, edges),
      flowOf([...nodes].reverse(), edges),
    ]) {
      assert.equal(alwaysBefore(flow, "a", "b"), true);
      assert.deepEqual(wiringAt(flow, "b", { facts }), {
        o: { from: "node", nodeId: "a", output: "o" },
      });
    }
  });
});

describe("flowFactsFrom", () => {
  test("builds the facts from a project's test and group lists", () => {
    const inputs = [{ name: "o", default: "d" }];
    const outputs = ["o"];
    const testIds = ["a", "b"];
    // Shaped like listTests / listGroups entries, with fields the facts don't use
    const tests = [
      { id: "a", outputs, name: "A", file: "a.spec.ts" },
      { id: "b", inputs },
      { id: "c" },
    ];
    const groups = [{ name: "gb", testIds, browsers: ["firefox"] }];
    const built = flowFactsFrom(tests, groups);
    assert.deepEqual(built, {
      tests: {
        a: { inputs: [], outputs: ["o"] },
        b: { inputs: [{ name: "o", default: "d" }], outputs: [] },
        c: { inputs: [], outputs: [] },
      },
      groups: { gb: ["a", "b"] },
    });
    // Copies: changing the lists given doesn't change the facts
    inputs.push({ name: "x", default: "" });
    outputs.push("x");
    testIds.push("c");
    assert.deepEqual(built.tests.b!.inputs, [{ name: "o", default: "d" }]);
    assert.deepEqual(built.tests.a!.outputs, ["o"]);
    assert.deepEqual(built.groups.gb, ["a", "b"]);
  });
});
