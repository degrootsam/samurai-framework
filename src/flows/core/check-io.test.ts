import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkFlow } from "./check.js";
import { stepNodeOf } from "./steps.js";
import type { FlowFile, FlowNodeModel } from "./schema.js";
import type { FlowFacts } from "./wiring.js";

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
const line = (...nodes: FlowNodeModel[]): FlowFile => {
  const all = [node("start", "start"), ...nodes, node("end", "end")];
  return {
    id: "f",
    name: "f",
    nodes: all,
    edges: all.slice(1).map((n, i) => edge(all[i]!.id, n.id)),
  };
};
const facts: FlowFacts = {
  tests: {
    a: { inputs: [], outputs: ["o"] },
    b: { inputs: [{ name: "o", default: "d" }], outputs: [] },
    p: { inputs: [], outputs: ["o", "only"] },
    q: { inputs: [], outputs: ["o"] },
  },
  groups: { gb: ["b"] },
};
const env = { name: "staging", variables: {} };
const io = (flow: FlowFile, options = {}) =>
  checkFlow(flow, { facts, ...options }).filter(
    (p) => !/Start connects/.test(p.message),
  );

describe("checkFlow: inputs and outputs", () => {
  test("without facts nothing new is reported", () => {
    const flow = line(
      node("b", "test", { inputs: { zz: { useDefault: true } } }),
    );
    assert.deepEqual(checkFlow(flow), []);
  });
  test("an input with no source is an error on its node", () => {
    assert.deepEqual(io(line(node("b", "test", { title: "Pay" }))), [
      {
        level: "error",
        nodeId: "b",
        message:
          'Pay: input "o" has no source. Save it as an output in an earlier test, set an expression, or use the default',
      },
    ]);
  });
  test("a wired, defaulted or overridden input is fine", () => {
    assert.deepEqual(io(line(node("a"), node("b"))), []);
    assert.deepEqual(
      io(line(node("b", "test", { inputs: { o: { useDefault: true } } }))),
      [],
    );
    assert.deepEqual(
      io(line(node("b", "test", { inputs: { o: { expression: '"x"' } } })), {
        environment: env,
      }),
      [],
    );
  });
  test("an override expression that doesn't check out is an error", () => {
    const flow = line(
      node("b", "test", { inputs: { o: { expression: "nodes.nope.o" } } }),
    );
    assert.deepEqual(io(flow, { environment: env }), [
      {
        level: "error",
        nodeId: "b",
        message: 'b: input "o": No node with key "nope"',
      },
    ]);
  });
  test("an override can name an earlier test's output, not a later one's", () => {
    const ok = line(
      node("a"),
      node("b", "test", { inputs: { o: { expression: "nodes.a.o" } } }),
    );
    assert.deepEqual(io(ok, { environment: env }), []);
    const late = line(
      node("b", "test", { inputs: { o: { expression: "nodes.a.o" } } }),
      node("a"),
    );
    assert.deepEqual(
      io(late, { environment: env }).map((p) => p.message),
      ['b: input "o": a runs after this node, so it has no result yet'],
    );
  });
  test("an entry for an input the test doesn't declare is a warning", () => {
    const flow = line(
      node("a"),
      node("b", "test", { inputs: { zz: { useDefault: true } } }),
    );
    assert.deepEqual(io(flow), [
      {
        level: "warning",
        nodeId: "b",
        message: 'input "zz" is not used by this test',
      },
    ]);
  });
  test("a Group node can't set an input with an expression", () => {
    const flow = line(
      node("a"),
      node("g", "group", {
        ref: { group: "gb" },
        inputs: { o: { expression: '"x"' } },
      }),
    );
    assert.deepEqual(io(flow), [
      {
        level: "error",
        nodeId: "g",
        message: 'g: Group nodes can\'t set inputs ("o")',
      },
    ]);
  });
  test("a malformed input entry in a flow built in memory is ignored, not a crash", () => {
    const flow = line(
      node("b", "test", {
        inputs: { o: "oops" } as unknown as FlowNodeModel["inputs"],
      }),
    );
    assert.deepEqual(
      io(flow).map((p) => p.message),
      [
        'b: input "o" has no source. Save it as an output in an earlier test, set an expression, or use the default',
      ],
    );
  });
  test("a Group node's inputs need a source too", () => {
    const flow = line(node("g", "group", { ref: { group: "gb" } }));
    assert.deepEqual(
      io(flow).map((p) => p.message),
      [
        'g: input "o" has no source. Save it as an output in an earlier test, set an expression, or use the default',
      ],
    );
  });
  test("two branches of one parallel saving the same output is an error", () => {
    const flow: FlowFile = {
      id: "f",
      name: "f",
      nodes: [
        node("start", "start"),
        node("par", "parallel", { title: "Both" }),
        node("p"),
        node("q"),
        node("b"),
        node("end", "end"),
      ],
      edges: [
        edge("start", "par"),
        edge("par", "p", "branch-0"),
        edge("par", "q", "branch-1"),
        edge("p", "b"),
        edge("q", "b"),
        edge("b", "end"),
      ],
    };
    assert.deepEqual(io(flow), [
      {
        level: "error",
        nodeId: "par",
        message: 'Both: branches both save "o"',
      },
    ]);
  });
  test("on a Group node an unused entry is not used by this node", () => {
    const flow = line(
      node("a"),
      node("g", "group", {
        ref: { group: "gb" },
        inputs: { zz: { useDefault: true } },
      }),
    );
    assert.deepEqual(
      io(flow).map((p) => p.message),
      ['input "zz" is not used by this node'],
    );
  });
  test("a branch merging into another before the meet is counted once", () => {
    // par → (y → x, z → x, w) → b; only x saves o
    const flow: FlowFile = {
      id: "f",
      name: "f",
      nodes: [
        node("start", "start"),
        node("par", "parallel"),
        node("y", "test", { ref: { testId: "none" } }),
        node("z", "test", { ref: { testId: "none" } }),
        node("x", "test", { ref: { testId: "a" } }),
        node("w", "test", { ref: { testId: "none" } }),
        node("b"),
        node("end", "end"),
      ],
      edges: [
        edge("start", "par"),
        edge("par", "y", "branch-0"),
        edge("par", "z", "branch-1"),
        edge("par", "w", "branch-2"),
        edge("y", "x"),
        edge("z", "x"),
        edge("x", "b"),
        edge("w", "b"),
        edge("b", "end"),
      ],
    };
    assert.deepEqual(io(flow), []);
    const clash: FlowFile = {
      ...flow,
      nodes: flow.nodes.map((n) =>
        n.id === "w" ? node("w", "test", { ref: { testId: "q" } }) : n,
      ),
    };
    assert.deepEqual(
      io(clash).map((p) => p.message),
      ['par: branches both save "o"'],
    );
  });
});

describe("checkFlow: expressions read a test's outputs with facts", () => {
  const setVariable = stepNodeOf({
    kind: "set-variable",
    label: "Set variable",
    icon: "braces",
    section: "control",
    fields: [
      { path: "config.name", type: "text", label: "Name", default: "" },
      { path: "config.value", type: "expression", label: "Value", default: "" },
    ],
    writesVar: "config.name",
  });
  const api = stepNodeOf({
    kind: "api",
    label: "HTTP request",
    icon: "globe",
    section: "integrations",
    fields: [
      { path: "config.url", type: "expression", label: "URL", default: "" },
    ],
  });
  const readers = [
    node("c", "condition", { config: { expr: 'nodes.a.o == "1"' } }),
    node("s", "set-variable", { config: { name: "v", value: "nodes.a.o" } }),
    node("h", "api", { config: { url: "nodes.a.o" } }),
  ];
  const options = { environment: env, nodes: [setVariable, api] };
  // a Condition in a line has one branch; only the expression problems matter here
  const exprIo = (f: FlowFile) =>
    io(f, options).filter((p) => !/needs both/.test(p.message));
  test("after the Test node: no problem", () => {
    assert.deepEqual(exprIo(line(node("a"), ...readers)), []);
  });
  test("before the Test node: it runs after this node", () => {
    assert.deepEqual(
      exprIo(line(...readers, node("a"))).map((p) => p.message),
      [
        "Condition: a runs after this node, so it has no result yet",
        "Set variable: a runs after this node, so it has no result yet",
        "HTTP request: a runs after this node, so it has no result yet",
      ],
    );
  });
});
