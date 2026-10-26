import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowFacts, FlowFile, InputSource } from "../core/index.js";
import type { TestResult } from "../../types/test.js";
import { runFlow, type RunFlowOptions } from "./run.js";

type N = {
  id: string;
  kind: string;
  title?: string;
  config?: Record<string, unknown>;
  onFailure?: "stop" | "continue";
  ref?: { testId?: string; group?: string };
  inputs?: Record<string, InputSource>;
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
const chain = (...ids: string[]) =>
  ids.slice(1).map((id, i) => [ids[i], id] as [string, string]);

/** Test `s::a` saves `o`; test `s::b` reads `o` (default "d") */
const facts: FlowFacts = {
  tests: {
    "s::a": { inputs: [], outputs: ["o"] },
    "s::b": { inputs: [{ name: "o", default: "d" }], outputs: [] },
  },
  groups: { both: ["s::a", "s::b"] },
};

const A: N = {
  id: "a",
  kind: "test",
  title: "Purchase",
  ref: { testId: "s::a" },
};
const B: N = { id: "b", kind: "test", ref: { testId: "s::b" } };
const START: N = { id: "start", kind: "start" };
const END: N = { id: "end", kind: "end" };

/**
 * A run where each node's one test ends with `saves[nodeId]` as its outputs (none when absent) and with
 * `failing` nodes failed; `calls` records the inputs each node's runTests got
 */
function harness(
  flow: FlowFile,
  over: Partial<RunFlowOptions> = {},
  saves: Record<string, Record<string, string>> = { a: { o: "42" } },
  failing: string[] = [],
) {
  const calls: { nodeId: string; inputs?: Record<string, string> }[] = [];
  const options: RunFlowOptions = {
    flow,
    facts,
    nodeTests: Object.fromEntries(
      flow.nodes
        .filter((n) => n.kind === "test" || n.kind === "group")
        .map((n) => [n.id, [{ file: "/p/s.spec.ts", name: n.id }]]),
    ),
    environment: { name: "staging", variables: { region: "eu" } },
    browser: "firefox",
    runTests: async ({ nodeId, tests, onEvent, browser, inputs }) => {
      calls.push({ nodeId, ...(inputs && { inputs }) });
      const failed = failing.includes(nodeId);
      for (const t of tests)
        onEvent({
          type: "test-end",
          name: t.name,
          file: t.file,
          browser,
          result: {
            name: t.name,
            file: t.file,
            browser,
            startTime: 0,
            duration: 1,
            status: failed ? "failed" : "success",
            ...(failed && { message: "no", type: "error" }),
            ...(saves[nodeId] && { outputs: saves[nodeId] }),
          } as TestResult,
        });
      return failed ? "failed" : "passed";
    },
    sleep: async () => {},
    ...over,
  };
  return { options, calls };
}

describe("runFlow wires outputs to inputs", () => {
  test("a Test node's saved outputs reach a later node's inputs", async () => {
    const h = harness(
      flowOf([START, A, B, END], chain("start", "a", "b", "end")),
    );
    const summary = await runFlow(h.options);
    assert.equal(summary.status, "passed");
    assert.deepEqual(h.calls, [
      { nodeId: "a" },
      { nodeId: "b", inputs: { o: "42" } },
    ]);
    assert.deepEqual(summary.nodes.a!.outputs, { o: "42" });
    assert.deepEqual(summary.nodes.b!.inputs, { o: "42" });
    assert.equal(summary.nodes.a!.inputs, undefined);
  });

  test("a condition reads a Test node's output at run time", async () => {
    const flow = flowOf(
      [
        START,
        A,
        { id: "c", kind: "condition", config: { expr: 'nodes.a.o == "42"' } },
        { id: "yes", kind: "wait", config: { ms: 1 } },
        { id: "no", kind: "wait", config: { ms: 1 } },
        END,
      ],
      [
        ["start", "a"],
        ["a", "c"],
        ["c", "yes", "true"],
        ["c", "no", "false"],
        ["yes", "end"],
        ["no", "end"],
      ],
    );
    const summary = await runFlow(harness(flow).options);
    assert.equal(summary.nodes.c!.error, undefined);
    assert.equal(summary.nodes.c!.branch, "true");
    assert.equal(summary.nodes.yes!.status, "passed");
    assert.equal(summary.nodes.no!.status, "skipped");
  });

  test("a producer skipped in this browser fails the consumer, which runs nothing", async () => {
    const h = harness(
      flowOf([START, A, B, END], chain("start", "a", "b", "end")),
      {
        nodeBrowsers: { a: ["chrome"], b: ["firefox", "chrome"] },
      },
    );
    const summary = await runFlow(h.options);
    assert.equal(summary.nodes.a!.status, "skipped");
    assert.equal(summary.nodes.b!.status, "failed");
    assert.equal(summary.nodes.b!.error, 'input "o": Purchase saved no o');
    assert.equal(summary.nodes.b!.inputs, undefined);
    assert.deepEqual(h.calls, []);
  });

  test("a producer that failed and continued fails the consumer", async () => {
    const h = harness(
      flowOf(
        [START, { ...A, onFailure: "continue" }, B, END],
        chain("start", "a", "b", "end"),
      ),
      {},
      { a: { o: "42" } },
      ["a"],
    );
    const summary = await runFlow(h.options);
    assert.equal(summary.nodes.a!.status, "failed");
    assert.equal(summary.nodes.a!.outputs, undefined);
    assert.equal(summary.nodes.b!.error, 'input "o": Purchase saved no o');
    assert.deepEqual(h.calls, [{ nodeId: "a" }]);
  });

  test("a producer that passed without saving the output fails the consumer", async () => {
    const h = harness(
      flowOf([START, A, B, END], chain("start", "a", "b", "end")),
      {},
      {},
    );
    const summary = await runFlow(h.options);
    assert.equal(summary.nodes.a!.status, "passed");
    assert.equal(summary.nodes.b!.error, 'input "o": Purchase saved no o');
  });

  test("an override: text passes, a number or boolean becomes text, anything else fails the node", async () => {
    const run = async (expression: string) => {
      const h = harness(
        flowOf(
          [
            START,
            { ...B, onFailure: "continue", inputs: { o: { expression } } },
            END,
          ],
          chain("start", "b", "end"),
        ),
      );
      const summary = await runFlow(h.options);
      return { result: summary.nodes.b!, calls: h.calls };
    };
    assert.deepEqual((await run('"abc"')).calls, [
      { nodeId: "b", inputs: { o: "abc" } },
    ]);
    assert.deepEqual((await run("env.region")).result.inputs, { o: "eu" });
    assert.deepEqual((await run("3")).result.inputs, { o: "3" });
    assert.deepEqual((await run("true")).result.inputs, { o: "true" });
    const none = await run("null");
    assert.equal(none.result.status, "failed");
    assert.equal(none.result.error, 'input "o": the expression gave no text');
    assert.deepEqual(none.calls, []);
    const bad = await run("env.missing");
    assert.equal(bad.result.status, "failed");
    assert.match(bad.result.error!, /^input "o": /);
    assert.deepEqual(bad.calls, []);
  });

  test("use the default: nothing is sent", async () => {
    const h = harness(
      flowOf(
        [START, A, { ...B, inputs: { o: { useDefault: true } } }, END],
        chain("start", "a", "b", "end"),
      ),
    );
    const summary = await runFlow(h.options);
    assert.equal(summary.status, "passed");
    assert.deepEqual(h.calls, [{ nodeId: "a" }, { nodeId: "b" }]);
    assert.equal(summary.nodes.b!.inputs, undefined);
  });

  test("a Group node gets its tests' inputs, and saves no outputs", async () => {
    const h = harness(
      flowOf(
        [START, A, { id: "g", kind: "group", ref: { group: "both" } }, END],
        chain("start", "a", "g", "end"),
      ),
      {},
      { a: { o: "42" }, g: { o: "7" } },
    );
    const summary = await runFlow(h.options);
    assert.deepEqual(h.calls[1], { nodeId: "g", inputs: { o: "42" } });
    assert.equal(summary.nodes.g!.outputs, undefined);
  });

  test("outputs saved on a Parallel branch reach a node after the meet", async () => {
    const flow = flowOf(
      [
        START,
        { id: "p", kind: "parallel" },
        A,
        { id: "w", kind: "wait", config: { ms: 1 } },
        { id: "m", kind: "wait", config: { ms: 1 } },
        B,
        END,
      ],
      [
        ["start", "p"],
        ["p", "a"],
        ["p", "w"],
        ["a", "m"],
        ["w", "m"],
        ["m", "b"],
        ["b", "end"],
      ],
    );
    const h = harness(flow);
    const summary = await runFlow(h.options);
    assert.equal(summary.status, "passed", JSON.stringify(summary.nodes));
    assert.deepEqual(summary.nodes.b!.inputs, { o: "42" });
  });

  test("without facts nothing is wired or sent", async () => {
    const h = harness(
      flowOf([START, A, B, END], chain("start", "a", "b", "end")),
    );
    delete h.options.facts;
    const summary = await runFlow(h.options);
    assert.equal(summary.status, "passed");
    assert.deepEqual(h.calls, [{ nodeId: "a" }, { nodeId: "b" }]);
  });
});
