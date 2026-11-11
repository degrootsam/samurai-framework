import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runFlow } from "./run.js";
import { match, flowOf, t, harness, chain } from "../../testing/flow-run.js";

describe("runFlow", () => {
  test("every event carries the run's browser, and runTests is told it", async () => {
    const browsers: string[] = [];
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
        browser: "chrome",
        runTests: async ({ browser, onEvent }) => {
          browsers.push(browser);
          onEvent({ type: "test-start", name: "a", file: "f", browser });
          return "passed";
        },
      },
    );
    await runFlow(h.options);
    assert.deepEqual(browsers, ["chrome"]);
    assert.ok(h.events.length > 4);
    for (const e of h.events)
      assert.equal((e as { browser?: string }).browser, "chrome", e.type);
  });

  test("a node whose browsers lack the run's is skipped with a note, the others run", async () => {
    const h = harness(
      flowOf(
        [
          { id: "start", kind: "start" },
          { id: "g", kind: "group", ref: { group: "chromeOnly" } },
          { id: "a", kind: "test" },
          { id: "e", kind: "group", ref: { group: "chromeOnly" } },
          { id: "end", kind: "end" },
        ],
        chain("start", "g", "a", "e", "end"),
      ),
      {},
      {
        nodeBrowsers: {
          g: ["chrome"],
          a: ["firefox", "chrome"],
          e: ["chrome"],
        },
      },
    );
    h.options.nodeTests.g = [t("g")];
    const summary = await runFlow(h.options);
    assert.deepEqual(h.ran, ["a"]);
    assert.equal(summary.status, "passed");
    assert.deepEqual(summary.nodes.g, {
      status: "skipped",
      note: "not run in firefox",
      durationMs: summary.nodes.g!.durationMs,
    });
    // An empty group outside its browsers is skipped too, not "has no tests"
    assert.equal(summary.nodes.e!.note, "not run in firefox");
  });

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

  test("tells runTests which node the tests are for", async () => {
    const nodeIds: string[] = [];
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
      {},
      {
        runTests: async ({ nodeId }) => {
          nodeIds.push(nodeId);
          return "passed";
        },
      },
    );
    await runFlow(h.options);
    assert.deepEqual(nodeIds, ["a", "b"]);
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
      {
        type: "node-end",
        browser: "firefox",
        nodeId: "no",
        result: { status: "skipped" },
      },
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
});
