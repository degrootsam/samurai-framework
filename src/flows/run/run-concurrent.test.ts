import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defineNode } from "../core/index.js";
import { HANDLERS } from "./handlers/index.js";
import { runFlow } from "./run.js";
import {
  type N,
  match,
  flowOf,
  harness,
  chain,
  ghost,
} from "../../testing/flow-run.js";

describe("runFlow", () => {
  describe("concurrent branches", () => {
    /** start -> par -> (b1 | b2) -> end, each branch one node of the given kind */
    const twoBranches = (
      b1: N,
      b2: N,
      onFailure: "stop" | "continue" = "stop",
    ) =>
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "par", kind: "parallel" },
          { ...b1, id: "b1", onFailure },
          { ...b2, id: "b2", onFailure },
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
    const set = (name: string, value: string): N => ({
      id: "",
      kind: "set-variable",
      config: { name, value },
    });
    const testNode: N = { id: "", kind: "test" };

    test("the branches run at the same time", async () => {
      let started!: () => void;
      const b2Started = new Promise<void>((r) => (started = r));
      const h = harness(
        twoBranches(testNode, testNode),
        {},
        {
          runTests: async ({ tests }) => {
            // b1 can only end once b2 has begun: sequential branches would wait forever
            if (tests[0]!.name === "b2") started();
            else await b2Started;
            return "passed";
          },
        },
      );
      const summary = await runFlow(h.options);
      assert.equal(summary.status, "passed");
      assert.equal(summary.nodes.par!.status, "passed");
    });

    test("variables set in different branches are all there after the join", async () => {
      const h = harness(twoBranches(set("a", "1"), set("b", "2")));
      const summary = await runFlow(h.options);
      assert.deepEqual(summary.vars, { a: 1, b: 2 });
      assert.equal(summary.status, "passed");
    });

    test("two branches setting a variable to different values fail the parallel", async () => {
      const h = harness(twoBranches(set("n", "1"), set("n", "2")));
      const summary = await runFlow(h.options);
      match(summary.nodes.par!, {
        status: "failed",
        error: "branches set n differently",
      });
      assert.equal(summary.status, "failed");
    });

    test("two branches setting a variable to the same value is no clash", async () => {
      const h = harness(twoBranches(set("n", "1"), set("n", "1")));
      const summary = await runFlow(h.options);
      assert.equal(summary.nodes.par!.status, "passed");
      assert.deepEqual(summary.vars, { n: 1 });
    });

    test("a stopping failure cancels the running sibling's tests", async () => {
      let siblingSignal: AbortSignal | undefined;
      const h = harness(
        twoBranches(testNode, testNode),
        { b1: "failed" },
        {
          runTests: async ({ tests, signal }) => {
            if (tests[0]!.name === "b1") return "failed";
            siblingSignal = signal;
            await new Promise((r) => signal.addEventListener("abort", r));
            return "cancelled";
          },
        },
      );
      const summary = await runFlow(h.options);
      assert.equal(siblingSignal?.aborted, true);
      assert.equal(
        h.controller.signal.aborted,
        false,
        "the run itself goes on",
      );
      match(summary.nodes.par!, {
        status: "failed",
        error: "A branch failed.",
      });
      assert.equal(summary.nodes.b2!.status, "not-run");
      assert.equal(summary.status, "failed");
    });

    test("a failure that continues leaves the sibling alone", async () => {
      let siblingSignal: AbortSignal | undefined;
      const h = harness(
        twoBranches(testNode, testNode, "continue"),
        { b1: "failed" },
        {
          runTests: async ({ tests, signal }) => {
            if (tests[0]!.name === "b1") return "failed";
            siblingSignal = signal;
            await new Promise((r) => setTimeout(r, 10));
            return signal.aborted ? "cancelled" : "passed";
          },
        },
      );
      const summary = await runFlow(h.options);
      assert.equal(siblingSignal?.aborted, false);
      assert.equal(summary.nodes.b2!.status, "passed");
      assert.equal(summary.nodes.par!.status, "failed");
    });

    test("stopping the run stops every branch", async () => {
      const h = harness(
        twoBranches(testNode, testNode),
        {},
        {
          runTests: async ({ signal }) => {
            await new Promise((r) => signal.addEventListener("abort", r));
            return "cancelled";
          },
        },
      );
      const done = runFlow(h.options);
      await new Promise((r) => setTimeout(r, 10));
      h.controller.abort();
      const summary = await done;
      assert.equal(summary.status, "cancelled");
    });

    test("each node's events stay in order while branches interleave", async () => {
      const h = harness(
        twoBranches(testNode, testNode),
        {},
        {
          runTests: async () => {
            await new Promise((r) => setTimeout(r, 5));
            return "passed";
          },
        },
      );
      await runFlow(h.options);
      const order = h.events.map(
        (e) => e.type + ("nodeId" in e ? `:${e.nodeId}` : ""),
      );
      for (const id of ["b1", "b2"])
        assert.ok(
          order.indexOf(`node-start:${id}`) < order.indexOf(`node-end:${id}`),
        );
      assert.ok(order.indexOf("node-start:b2") < order.indexOf("node-end:b1"));
    });
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
          { id: "http", kind: "ghost" },
          { id: "end", kind: "end" },
        ],
        chain("start", "http", "end"),
      ),
      {},
      { nodes: [ghost] },
    );
    await assert.rejects(runFlow(h.options), /Ghost can’t run yet/);
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
      "This flow’s shape can’t run: start has 2 ways out.",
    );
  });
});
