import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowFile } from "../core/index.js";
import type { FlowEvent, NodeTest } from "./events.js";
import { defineNode } from "../core/index.js";
import { HANDLERS } from "./handlers/index.js";
import { runFlow, type RunFlowOptions } from "./run.js";

const match = (actual: unknown, expected: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(expected))
    assert.deepEqual((actual as Record<string, unknown>)[k], v);
};

type N = {
  id: string;
  kind: string;
  config?: Record<string, unknown>;
  onFailure?: "stop" | "continue";
  ref?: { testId?: string; group?: string };
};
const flowOf = (nodes: N[], edges: [string, string, string?][]): FlowFile => ({
  id: "f",
  name: "f",
  nodes: nodes.map((n) => ({
    onFailure: "stop",
    position: { x: 0, y: 0 },
    key: n.id,
    ...n,
  })),
  edges: edges.map(([source, target, sourceHandle]) => ({
    id: `${source}-${target}-${sourceHandle ?? ""}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  })),
});
const t = (name: string): NodeTest => ({ file: "/p/a.spec.ts", name });

function harness(
  flow: FlowFile,
  results: Record<string, "passed" | "failed"> = {},
  over: Partial<RunFlowOptions> = {},
) {
  const events: FlowEvent[] = [];
  const ran: string[] = [];
  const controller = new AbortController();
  const options: RunFlowOptions = {
    flow,
    nodeTests: Object.fromEntries(
      flow.nodes.filter((n) => n.kind === "test").map((n) => [n.id, [t(n.id)]]),
    ),
    environment: { name: "staging", variables: { region: "eu" } },
    startedAt: "2026-10-07T10:00:00Z",
    signal: controller.signal,
    onEvent: (e) => events.push(e),
    runTests: async ({ tests }) => {
      ran.push(...tests.map((x) => x.name));
      return tests.some((x) => results[x.name] === "failed")
        ? "failed"
        : "passed";
    },
    sleep: async () => {},
    ...over,
  };
  return { options, events, ran, controller };
}

const chain = (...ids: string[]) =>
  ids.slice(1).map((id, i) => [ids[i], id] as [string, string]);

describe("runFlow", () => {
  test("runs test nodes in order and passes", async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "a", kind: "test" },
          { id: "b", kind: "test" },
          { id: "end", kind: "end" },
        ],
        chain("start", "a", "b", "end"),
      ),
    );
    const summary = await runFlow(h.options);
    assert.deepEqual(h.ran, ["a", "b"]);
    assert.equal(summary.status, "passed");
    assert.deepEqual(
      Object.values(summary.nodes).map((r) => r.status),
      ["passed", "passed", "passed", "passed"],
    );
  });

  test("a failure with Stop ends the run; the rest is not run", async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "a", kind: "test" },
          { id: "b", kind: "test" },
          { id: "end", kind: "end" },
        ],
        chain("start", "a", "b", "end"),
      ),
      { a: "failed" },
    );
    const summary = await runFlow(h.options);
    assert.deepEqual(h.ran, ["a"]);
    assert.equal(summary.status, "failed");
    assert.equal(summary.nodes.b!.status, "not-run");
    assert.equal(summary.nodes.end!.status, "not-run");
  });

  test("a failure with Continue goes on, and the flow still fails", async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "a", kind: "test", onFailure: "continue" },
          { id: "b", kind: "test" },
          { id: "end", kind: "end" },
        ],
        chain("start", "a", "b", "end"),
      ),
      { a: "failed" },
    );
    const summary = await runFlow(h.options);
    assert.deepEqual(h.ran, ["a", "b"]);
    assert.equal(summary.status, "failed");
  });

  const branching = (expr: string) =>
    flowOf(
      [
        { id: "start", kind: "start" },
        { id: "set", kind: "set-variable", config: { name: "n", value: "2" } },
        { id: "cond", kind: "condition", config: { expr } },
        { id: "yes", kind: "test" },
        { id: "no", kind: "test" },
        { id: "after", kind: "test" },
        { id: "end", kind: "end" },
      ],
      [
        ["start", "set"],
        ["set", "cond"],
        ["cond", "yes", "true"],
        ["cond", "no", "false"],
        ["yes", "after"],
        ["no", "after"],
        ["after", "end"],
      ],
    );

  test("a condition follows its branch and skips the other", async () => {
    const h = harness(branching('vars.n > 1 && env.region == "eu"'));
    const summary = await runFlow(h.options);
    assert.deepEqual(h.ran, ["yes", "after"]);
    match(summary.nodes.cond!, { status: "passed", branch: "true" });
    assert.equal(summary.nodes.no!.status, "skipped");
    assert.deepEqual(
      h.events.find((e) => e.type === "node-end" && e.nodeId === "no"),
      { type: "node-end", nodeId: "no", result: { status: "skipped" } },
    );
    assert.deepEqual(summary.nodes.set!.wrote, { n: 2 });
    assert.deepEqual(summary.vars, { n: 2 });
  });

  test("a failing expression fails the condition and skips both branches when it continues", async () => {
    const f = branching("vars.n -");
    f.nodes.find((n) => n.id === "cond")!.onFailure = "continue";
    const h = harness(f);
    const summary = await runFlow(h.options);
    assert.equal(summary.nodes.cond!.status, "failed");
    assert.equal(summary.nodes.cond!.error, "The expression ends too early");
    assert.equal(summary.nodes.yes!.status, "skipped");
    assert.deepEqual(h.ran, ["after"]);
  });

  test("the runtime re-checks expressions: an unknown node key fails the condition", async () => {
    const f = flowOf(
      [
        { id: "start", kind: "start" },
        {
          id: "cond",
          kind: "condition",
          config: { expr: 'nodes.nope.status == "passed"' },
        },
        { id: "left", kind: "test" },
        { id: "right", kind: "test" },
        { id: "end", kind: "end" },
      ],
      [
        ["start", "cond"],
        ["cond", "left", "true"],
        ["cond", "right", "false"],
        ["left", "end"],
        ["right", "end"],
      ],
    );
    const h = harness(f);
    const summary = await runFlow(h.options);
    match(summary.nodes.cond!, {
      status: "failed",
      error: 'No node with key "nope"',
    });
    assert.equal(summary.status, "failed");
    assert.deepEqual(h.ran, []);
  });

  test("the runtime re-checks expressions: a variable the environment lacks fails the condition", async () => {
    const h = harness(branching("env.missing"));
    const summary = await runFlow(h.options);
    match(summary.nodes.cond!, {
      status: "failed",
      error: "missing isn't a variable of staging",
    });
  });

  test("the runtime re-checks a Set variable's value", async () => {
    const f = branching("true");
    f.nodes.find((n) => n.id === "set")!.config = {
      name: "n",
      value: "vars.later",
    };
    const summary = await runFlow(harness(f).options);
    match(summary.nodes.set!, {
      status: "failed",
      error: "vars.later isn't set before this node",
    });
  });

  test("conditions can read earlier node results", async () => {
    const f = flowOf(
      [
        { id: "start", kind: "start" },
        { id: "login", kind: "test", onFailure: "continue" },
        {
          id: "cond",
          kind: "condition",
          config: { expr: 'nodes.login.status == "failed"' },
        },
        { id: "yes", kind: "test" },
        { id: "no", kind: "test" },
        { id: "end", kind: "end" },
      ],
      [
        ["start", "login"],
        ["login", "cond"],
        ["cond", "yes", "true"],
        ["cond", "no", "false"],
        ["yes", "end"],
        ["no", "end"],
      ],
    );
    const h = harness(f, { login: "failed" });
    await runFlow(h.options);
    assert.deepEqual(h.ran, ["login", "yes"]);
  });

  test("parallel runs its filled branches left to right", async () => {
    const f = flowOf(
      [
        { id: "start", kind: "start" },
        { id: "par", kind: "parallel" },
        { id: "b1", kind: "test" },
        { id: "b2", kind: "test" },
        { id: "end", kind: "end" },
      ],
      [
        ["start", "par"],
        ["par", "b2", "branch-1"],
        ["par", "b1", "branch-0"],
        ["par", "end", "branch-2"],
        ["b1", "end"],
        ["b2", "end"],
      ],
    );
    const h = harness(f, { b1: "failed" });
    f.nodes.find((n) => n.id === "b1")!.onFailure = "continue";
    const summary = await runFlow(h.options);
    assert.deepEqual(h.ran, ["b1", "b2"]);
    assert.equal(summary.nodes.par!.status, "failed");
  });

  test("wait waits for its duration and stopping during it cancels the run", async () => {
    const f = flowOf(
      [
        { id: "start", kind: "start" },
        { id: "w", kind: "wait", config: { ms: 5000 } },
        { id: "a", kind: "test" },
        { id: "end", kind: "end" },
      ],
      chain("start", "w", "a", "end"),
    );
    const waited: number[] = [];
    const h = harness(f, {}, {});
    h.options.sleep = (ms, signal) => {
      waited.push(ms);
      h.controller.abort();
      return new Promise((_, reject) =>
        signal.aborted
          ? reject(new Error("aborted"))
          : signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
      );
    };
    const summary = await runFlow(h.options);
    assert.deepEqual(waited, [5000]);
    assert.equal(summary.status, "cancelled");
    assert.equal(summary.nodes.a!.status, "not-run");
    assert.deepEqual(h.ran, []);
  });

  test('unsupported "skip": kinds without a handler are skipped with a note', async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "http", kind: "api" },
          { id: "end", kind: "end" },
        ],
        chain("start", "http", "end"),
      ),
      {},
      { unsupported: "skip" },
    );
    const summary = await runFlow(h.options);
    match(summary.nodes.http!, {
      status: "skipped",
      note: "Not supported yet",
    });
    assert.equal(summary.status, "passed");
  });

  test("a test node whose test was deleted fails with a clear message", async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "a", kind: "test" },
          { id: "end", kind: "end" },
        ],
        chain("start", "a", "end"),
      ),
    );
    h.options.nodeTests = {};
    const summary = await runFlow(h.options);
    match(summary.nodes.a!, {
      status: "failed",
      error: "This test was deleted or moved.",
    });
  });

  test("an empty group passes with a note", async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "g", kind: "group", ref: { group: "smoke" } },
          { id: "end", kind: "end" },
        ],
        chain("start", "g", "end"),
      ),
    );
    h.options.nodeTests = { g: [] };
    const summary = await runFlow(h.options);
    match(summary.nodes.g!, {
      status: "passed",
      note: "This group has no tests.",
    });
  });

  test("a shape the runtime can't walk fails the run instead of looping", async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "a", kind: "test" },
          { id: "b", kind: "test" },
          { id: "end", kind: "end" },
        ],
        [
          ["start", "a"],
          ["a", "b"],
          ["b", "a"],
        ],
      ),
    );
    const summary = await runFlow(h.options);
    assert.equal(summary.status, "failed");
    assert.equal(
      summary.error,
      "This flow's shape can't run: a is reached twice.",
    );
  });

  test("events: flow-start, node start/end pairs in order, flow-end", async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "a", kind: "test" },
          { id: "end", kind: "end" },
        ],
        chain("start", "a", "end"),
      ),
    );
    await runFlow(h.options);
    assert.deepEqual(
      h.events.map((e) => e.type + ("nodeId" in e ? `:${e.nodeId}` : "")),
      [
        "flow-start",
        "node-start:start",
        "node-end:start",
        "node-start:a",
        "node-end:a",
        "node-start:end",
        "node-end:end",
        "flow-end",
      ],
    );
  });

  test("a parallel ends once, after its branches, with their total duration", async () => {
    const f = flowOf(
      [
        { id: "start", kind: "start" },
        { id: "par", kind: "parallel" },
        { id: "b1", kind: "test" },
        { id: "b2", kind: "test" },
        { id: "end", kind: "end" },
      ],
      [
        ["start", "par"],
        ["par", "b1", "branch-0"],
        ["par", "b2", "branch-1"],
        ["b1", "end"],
        ["b2", "end"],
      ],
    );
    const h = harness(
      f,
      {},
      {
        runTests: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return "passed";
        },
      },
    );
    const summary = await runFlow(h.options);
    const order = h.events.map(
      (e) => e.type + ("nodeId" in e ? `:${e.nodeId}` : ""),
    );
    assert.equal(order.filter((x) => x === "node-end:par").length, 1);
    assert.ok(order.indexOf("node-end:par") > order.indexOf("node-end:b2"));
    assert.ok(order.indexOf("node-end:par") < order.indexOf("node-start:end"));
    assert.equal(summary.nodes.par!.status, "passed");
    assert.ok(summary.nodes.par!.durationMs! >= 25);
  });

  test("a failing branch ends the parallel once, as failed", async () => {
    const f = flowOf(
      [
        { id: "start", kind: "start" },
        { id: "par", kind: "parallel" },
        { id: "b1", kind: "test", onFailure: "continue" },
        { id: "b2", kind: "test" },
        { id: "end", kind: "end" },
      ],
      [
        ["start", "par"],
        ["par", "b1", "branch-0"],
        ["par", "b2", "branch-1"],
        ["b1", "end"],
        ["b2", "end"],
      ],
    );
    const h = harness(f, { b1: "failed" });
    await runFlow(h.options);
    const ends = h.events.filter(
      (e) => e.type === "node-end" && e.nodeId === "par",
    );
    assert.equal(ends.length, 1);
    match((ends[0] as { result: unknown }).result, {
      status: "failed",
      error: "A branch failed.",
    });
  });

  test("a Stop failing in a non-last parallel branch fails the parallel", async () => {
    const f = flowOf(
      [
        { id: "start", kind: "start" },
        { id: "par", kind: "parallel" },
        { id: "b1", kind: "test" },
        { id: "b2", kind: "test" },
        { id: "end", kind: "end" },
      ],
      [
        ["start", "par"],
        ["par", "b1", "branch-0"],
        ["par", "b2", "branch-1"],
        ["par", "end", "branch-2"],
        ["b1", "end"],
        ["b2", "end"],
      ],
    );
    const h = harness(f, { b1: "failed" });
    const summary = await runFlow(h.options);
    assert.equal(summary.nodes.par!.status, "failed");
    assert.equal(summary.nodes.b1!.status, "failed");
    assert.equal(summary.nodes.b2!.status, "not-run");
    assert.equal(summary.status, "failed");
  });

  test("a rejecting runTests fails the node and the flow still ends", async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "a", kind: "test" },
          { id: "end", kind: "end" },
        ],
        chain("start", "a", "end"),
      ),
      {},
      {
        runTests: async () => {
          throw new Error("boom");
        },
      },
    );
    const summary = await runFlow(h.options);
    match(summary.nodes.a!, { status: "failed", error: "boom" });
    assert.equal(summary.status, "failed");
    assert.equal(h.events[h.events.length - 1]!.type, "flow-end");
  });

  test('unsupported "fail" (the default) refuses to start: nothing runs, no event', async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "http", kind: "api" },
          { id: "end", kind: "end" },
        ],
        chain("start", "http", "end"),
      ),
    );
    await assert.rejects(
      runFlow(h.options),
      /HTTP request can't run yet|can't run yet/,
    );
    assert.deepEqual(h.events, []);
  });

  test("a new kind with a fixed list of branches runs with no change to the walker", async () => {
    const coin = defineNode({
      kind: "coin",
      label: "Coin",
      shape: "branches",
      branches: [{ name: "heads" }, { name: "tails" }],
      fields: [],
    });
    const f = flowOf(
      [
        { id: "start", kind: "start" },
        { id: "c", kind: "coin" },
        { id: "h", kind: "test" },
        { id: "t", kind: "test" },
        { id: "end", kind: "end" },
      ],
      [
        ["start", "c"],
        ["c", "h", "heads"],
        ["c", "t", "tails"],
        ["h", "end"],
        ["t", "end"],
      ],
    );
    const h = harness(
      f,
      {},
      {
        nodes: [coin],
        handlers: {
          ...HANDLERS,
          coin: async () => ({ status: "passed", branch: "tails" }),
        },
      },
    );
    const summary = await runFlow(h.options);
    assert.deepEqual(h.ran, ["t"]);
    assert.equal(summary.nodes.h!.status, "skipped");
    match(summary.nodes.c!, { status: "passed", branch: "tails" });
    assert.equal(summary.status, "passed");
  });

  test("a step with two ways out can't run", async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "a", kind: "test" },
          { id: "b", kind: "test" },
          { id: "end", kind: "end" },
        ],
        [
          ["start", "a"],
          ["start", "b"],
          ["a", "end"],
          ["b", "end"],
        ],
      ),
    );
    const summary = await runFlow(h.options);
    assert.equal(
      summary.error,
      "This flow's shape can't run: start has 2 ways out.",
    );
  });
});
