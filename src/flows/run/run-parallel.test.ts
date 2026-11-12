import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runFlow } from "./run.js";
import {
  match,
  flowOf,
  harness,
  chain,
  ghost,
} from "../../testing/flow-run.js";

describe("runFlow", () => {
  test("parallel starts its filled branches left to right", async () => {
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
          { id: "http", kind: "ghost" },
          { id: "end", kind: "end" },
        ],
        chain("start", "http", "end"),
      ),
      {},
      { unsupported: "skip", nodes: [ghost] },
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
      "This flow’s shape can’t run: a is reached twice.",
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

  test("a parallel ends once, after its branches, with the time they took", async () => {
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
    // Both branches wait 15 ms, at the same time
    assert.ok(summary.nodes.par!.durationMs! >= 12);
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
    // b2 is still running when b1 fails: it is cancelled
    const h = harness(
      f,
      { b1: "failed" },
      {
        runTests: async ({ tests, signal }) => {
          if (tests[0]!.name === "b1") return "failed";
          await new Promise((r) => signal.addEventListener("abort", r));
          return "cancelled";
        },
      },
    );
    const summary = await runFlow(h.options);
    assert.equal(summary.nodes.par!.status, "failed");
    assert.equal(summary.nodes.b1!.status, "failed");
    assert.equal(summary.nodes.b2!.status, "not-run");
    assert.equal(summary.status, "failed");
  });
});
