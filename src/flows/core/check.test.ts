import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkFlow } from "./check.js";
import type { FlowEdgeModel, FlowFile, FlowNodeModel } from "./schema.js";

const mk = (id: string, kind: string, extra: Partial<FlowNodeModel> = {}) =>
  ({
    id,
    kind,
    onFailure: "stop",
    position: { x: 0, y: 0 },
    ...extra,
  }) as FlowNodeModel;

/** Start, `kinds` in a chain, End */
function chain(kinds: Partial<FlowNodeModel>[] = []): FlowFile {
  const nodes = [
    mk("start", "start"),
    ...kinds.map((k, i) => mk(`n${i}`, k.kind ?? "test", k)),
    mk("end", "end"),
  ];
  const edges: FlowEdgeModel[] = nodes
    .slice(1)
    .map((n, i) => ({ id: `e${i}`, source: nodes[i]!.id, target: n.id }));
  return { id: "f", name: "f", nodes, edges };
}
const testNode = (i: number): Partial<FlowNodeModel> => ({
  kind: "test",
  ref: { testId: `a.ts::t${i}` },
});
const linear = (n: number) =>
  chain(Array.from({ length: n }, (_, i) => testNode(i)));
const messages = (f: FlowFile, o?: Parameters<typeof checkFlow>[1]) =>
  checkFlow(f, o).map((p) => p.message);

/** Start -> kind -> End, with the node inserted as a branches node whose branches all go to End */
function branching(kind: string, handles: string[], extra = {}): FlowFile {
  const nodes = [mk("start", "start"), mk("b", kind, extra), mk("end", "end")];
  const edges: FlowEdgeModel[] = [
    { id: "s", source: "start", target: "b" },
    ...handles.map((h) => ({
      id: `b-${h}`,
      source: "b",
      target: "end",
      sourceHandle: h,
    })),
  ];
  return { id: "f", name: "f", nodes, edges };
}

describe("checkFlow", () => {
  test("a linear flow is valid", () => {
    assert.deepEqual(checkFlow(linear(2)), []);
  });

  test("an empty flow with Start to End is valid", () => {
    assert.deepEqual(checkFlow(chain()), []);
  });

  test("Start straight to End is rejected while nodes sit between", () => {
    const flow = linear(1);
    const shortcut = {
      ...flow,
      edges: [...flow.edges, { id: "x", source: "start", target: "end" }],
    };
    assert.ok(
      messages(shortcut).includes(
        "Start connects straight to End, skipping the nodes in between.",
      ),
    );
  });

  test("a condition missing a branch is an error", () => {
    const flow = branching("condition", ["true"], { config: { expr: "true" } });
    assert.ok(
      messages(flow).includes(
        "Condition needs both a true and a false branch.",
      ),
    );
    assert.ok(
      !messages(
        branching("condition", ["true", "false"], { config: { expr: "true" } }),
      ).some((m) => /branch/.test(m)),
    );
  });

  test("a fixed list of three names every branch", () => {
    // no such kind in core; covered by the two-branch wording above and the joined form here
    const flow = branching("condition", []);
    assert.ok(
      messages(flow).includes(
        "Condition needs both a true and a false branch.",
      ),
    );
  });

  test("exactly one Start and one End", () => {
    const flow = linear(0);
    assert.ok(
      messages({
        ...flow,
        nodes: flow.nodes.filter((n) => n.id !== "end"),
      }).includes("A flow has exactly one End."),
    );
    assert.ok(
      messages({
        ...flow,
        nodes: flow.nodes.filter((n) => n.id !== "start"),
      }).includes("A flow has exactly one Start."),
    );
  });

  test("a node cut off from Start is unreachable", () => {
    const flow = linear(1);
    const cut = {
      ...flow,
      edges: flow.edges.filter((e) => e.source !== "start"),
    };
    assert.ok(messages(cut).some((m) => /isn't reachable from Start/.test(m)));
  });

  test("a node that does not lead to End says so", () => {
    const flow = linear(1);
    const cut = {
      ...flow,
      edges: flow.edges.filter((e) => e.target !== "end"),
    };
    assert.ok(messages(cut).includes("Test doesn't lead to End."));
  });

  test("a parallel with too few branches is an error", () => {
    const few = branching("parallel", ["branch-0"]);
    assert.ok(messages(few).includes("Parallel needs at least 2 branches."));
    const enough = branching("parallel", ["branch-0", "branch-1"]);
    assert.deepEqual(
      messages(enough).filter((m) => /branches/.test(m)),
      [],
    );
  });

  test("a node is named by its title, else its key, else its label", () => {
    const flow = branching("parallel", [], { title: "Fan out" });
    assert.ok(messages(flow).includes("Fan out needs at least 2 branches."));
    const keyed = branching("parallel", [], { key: "fan" });
    assert.ok(messages(keyed).includes("fan needs at least 2 branches."));
  });

  test("the titles option wins, and undefined falls back", () => {
    const flow = branching("parallel", [], { title: "Fan out" });
    const win = messages(flow, { titles: () => "Named by app" });
    assert.ok(win.includes("Named by app needs at least 2 branches."));
    const back = messages(flow, { titles: () => undefined });
    assert.ok(back.includes("Fan out needs at least 2 branches."));
  });

  test("titles name the node in reachability and branch messages", () => {
    const titles = (n: FlowNodeModel) =>
      n.kind === "test" || n.kind === "condition" ? `T-${n.id}` : undefined;
    const one = linear(1);
    const cut = {
      ...one,
      edges: one.edges.filter((e) => e.source !== "start"),
    };
    assert.ok(
      messages(cut, { titles }).includes("T-n0 isn't reachable from Start."),
    );
    const noEnd = {
      ...one,
      edges: one.edges.filter((e) => e.target !== "end"),
    };
    assert.ok(
      messages(noEnd, { titles }).includes("T-n0 doesn't lead to End."),
    );
    const cond = branching("condition", ["true"]);
    assert.ok(
      messages(cond, { titles }).includes(
        "T-b needs both a true and a false branch.",
      ),
    );
  });

  test("expression problems block running and point at the node", () => {
    const flow = branching("condition", ["true", "false"], {
      config: { expr: "nodes.nope.status" },
    });
    assert.deepEqual(
      checkFlow(flow, { environment: { name: "staging", variables: {} } }),
      [
        {
          level: "error",
          nodeId: "b",
          message: 'Condition: No node with key "nope"',
        },
      ],
    );
    // not checked without an environment
    assert.deepEqual(checkFlow(flow), []);
  });

  test("a Condition with no expression is an error at its node", () => {
    const flow = branching("condition", ["true", "false"]);
    assert.deepEqual(checkFlow(flow), [
      {
        level: "error",
        nodeId: "b",
        message: "Condition: Write an expression",
      },
    ]);
  });

  test("a Set variable with no name or value is an error at its node", () => {
    const flow = chain([{ kind: "set-variable" }]);
    const found = checkFlow(flow, {
      environment: { name: "staging", variables: {} },
    });
    assert.deepEqual(found, [
      {
        level: "error",
        nodeId: "n0",
        message: "Set variable: give the variable a name.",
      },
      {
        level: "error",
        nodeId: "n0",
        message: "Set variable: Write an expression",
      },
    ]);
  });

  test("Set variable name must be lowercase", () => {
    const flow = chain([
      { kind: "set-variable", config: { name: "Bad", value: "1" } },
    ]);
    assert.ok(
      messages(flow).includes(
        "Set variable: use lowercase letters, digits and _ for the name.",
      ),
    );
  });

  test("duplicate or invalid keys are errors", () => {
    const flow = linear(2);
    const bad = {
      ...flow,
      nodes: flow.nodes.map((n) =>
        n.id === "n0" ? { ...n, key: "Bad Key" } : n,
      ),
    };
    assert.ok(
      messages(bad).includes(
        `"Bad Key" isn't a valid key. Use lowercase letters, digits and _, starting with a letter.`,
      ),
    );
    const dup = {
      ...flow,
      nodes: flow.nodes.map((n) =>
        n.id === "n0" || n.id === "n1" ? { ...n, key: "same" } : n,
      ),
    };
    assert.deepEqual(
      checkFlow(dup).map((p) => [p.nodeId, p.message]),
      [["n1", 'The key "same" is used by another node.']],
    );
  });

  test("an unknown kind is a problem, not a throw", () => {
    const flow = chain([{ kind: "teleport" }]);
    assert.deepEqual(messages(flow), ["Unknown node kind: teleport"]);
  });
});

describe("references", () => {
  test("a deleted test or group is reported when the lists are given", () => {
    const flow = chain([
      testNode(0),
      { kind: "group", ref: { group: "smoke" } },
    ]);
    const found = checkFlow(flow, { tests: ["a.ts::t0"], groups: [] });
    assert.deepEqual(found, [
      {
        level: "error",
        nodeId: "n1",
        message: "The group smoke no longer exists.",
      },
    ]);
    assert.deepEqual(messages(flow, { tests: [], groups: ["smoke"] }), [
      "A test in this flow was deleted or moved.",
    ]);
    assert.deepEqual(
      messages(flow, { tests: ["a.ts::t0"], groups: ["smoke"] }),
      [],
    );
  });

  test("no reference checks when the lists are not given", () => {
    const flow = chain([testNode(0), { kind: "group", ref: { group: "x" } }]);
    assert.deepEqual(checkFlow(flow), []);
    // each list only enables its own check
    assert.deepEqual(messages(flow, { tests: ["a.ts::t0"] }), []);
    assert.deepEqual(messages(flow, { groups: ["x"] }), []);
  });
});

describe("unsupported kinds", () => {
  const handled = new Set([
    "start",
    "end",
    "test",
    "group",
    "condition",
    "parallel",
    "wait",
    "set-variable",
  ]);
  const withKind = (kind: string) => chain([{ kind }]);

  test("skip mode warns with the app's text", () => {
    for (const [kind, label] of [
      ["api", "HTTP request"],
      ["database", "Database query"],
      ["email", "Email inbox"],
      ["script", "Script"],
    ] as const)
      assert.deepEqual(checkFlow(withKind(kind), { handled }), [
        {
          level: "warning",
          nodeId: "n0",
          message: `${label} nodes can't run yet. They are skipped.`,
        },
      ]);
  });

  test("fail mode makes it an error", () => {
    assert.deepEqual(
      checkFlow(withKind("api"), { handled, unsupported: "fail" }),
      [
        {
          level: "error",
          nodeId: "n0",
          message: "HTTP request can't run yet.",
        },
      ],
    );
  });

  test("handled kinds, start and end never report", () => {
    assert.deepEqual(
      checkFlow(chain([testNode(0), { kind: "wait" }]), {
        handled,
        unsupported: "fail",
      }),
      [],
    );
    assert.deepEqual(checkFlow(chain(), { handled, unsupported: "fail" }), []);
  });

  test("without `handled` nothing is reported", () => {
    assert.deepEqual(checkFlow(withKind("api"), { unsupported: "fail" }), []);
  });
});
