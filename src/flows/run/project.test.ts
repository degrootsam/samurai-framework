import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { FlowFile } from "../core/index.js";
import type { SamuraiTestConfig } from "../../types/config.js";
import type { runTests } from "../../runner/run.js";
import type { PoolOptions, RunHooks } from "../../runner/worker-pool.js";
import type { WorkItem } from "../../runner/worker-protocol.js";
import type { TestResult } from "../../types/test.js";
import { defineStep } from "../steps/index.js";
import type { FlowEvent } from "./events.js";
import {
  FlowCheckError,
  chooseEnvironment,
  runFlowInProject,
  type RunFlowInProjectOptions,
  nodeTestsOf,
} from "./project.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
let dir: string;

const spec = (body: string) =>
  `import { describe, test } from ${API};\n${body}`;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "samurai-flow-project-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(dir, "src/checkout"), { recursive: true });
  mkdirSync(path.join(dir, "flows"));
  writeFileSync(
    path.join(dir, "src/login.spec.ts"),
    spec(
      `test("works", async () => {});\ntest("fails nicely", async () => {});`,
    ),
  );
  writeFileSync(
    path.join(dir, "src/checkout/cart.spec.ts"),
    spec(`describe("Cart", () => { test("adds", async () => {}); });`),
  );
});
after(() => rmSync(dir, { recursive: true, force: true }));

const config: SamuraiTestConfig = {
  environments: {
    dev: { variables: { region: "us" } },
    staging: { variables: { region: "eu" } },
  },
  defaultEnvironment: "dev",
  groups: [
    { name: "checkout", src: "./src/checkout" },
    {
      name: "cross",
      src: "./src/checkout",
      browsers: ["firefox", "chrome"],
    },
    { name: "empty", tests: [{ file: "login.spec.ts", title: "gone" }] },
  ],
};

type N = {
  id: string;
  kind: string;
  config?: Record<string, unknown>;
  ref?: { testId?: string; group?: string };
};
const flowOf = (
  nodes: N[],
  ids: string[],
  extra: Partial<FlowFile> = {},
): FlowFile => ({
  id: "f",
  name: "f",
  nodes: nodes.map((n) => ({
    onFailure: "stop" as const,
    position: { x: 0, y: 0 },
    key: n.id,
    ...n,
  })),
  edges: ids.slice(1).map((id, i) => ({
    id: `e${i}`,
    source: ids[i]!,
    target: id,
  })),
  ...extra,
});
const START: N = { id: "start", kind: "start" };
const END: N = { id: "end", kind: "end" };
const chain = (nodes: N[], extra?: Partial<FlowFile>) =>
  flowOf(
    [START, ...nodes, END],
    ["start", ...nodes.map((n) => n.id), "end"],
    extra,
  );

type Call = Parameters<typeof runTests>[0];
function harness(over: Partial<RunFlowInProjectOptions> = {}) {
  const calls: NonNullable<Call>[] = [];
  const events: FlowEvent[] = [];
  const options = {
    projectDir: dir,
    config,
    onEvent: (e: FlowEvent) => events.push(e),
    testRunner: (async (o: Call) => {
      calls.push(o!);
      return { status: "success" } as Awaited<ReturnType<typeof runTests>>;
    }) as typeof runTests,
    ...over,
  };
  return { options, calls, events };
}

describe("runFlowInProject", () => {
  it("runs a Test node narrowed to its file and name, with the environment the project defines", async () => {
    const h = harness();
    const summary = await runFlowInProject({
      ...h.options,
      flow: chain([
        {
          id: "t",
          kind: "test",
          ref: { testId: "checkout/cart.spec.ts::Cart > adds" },
        },
      ]),
    });
    assert.equal(summary.status, "passed");
    assert.equal(h.calls.length, 1);
    // The real path: registered test files come from stack traces
    assert.deepEqual(h.calls[0]!.files, [
      path.join(realpathSync(dir), "src/checkout/cart.spec.ts"),
    ]);
    assert.deepEqual(h.calls[0]!.testNames, ["Cart > adds"]);
    assert.equal(h.calls[0]!.environment, "dev");
    assert.equal(h.calls[0]!.reportPath, false);
  });

  it("a Group node runs the tests the group resolves to, one run for the node", async () => {
    const h = harness();
    await runFlowInProject({
      ...h.options,
      flow: chain([{ id: "g", kind: "group", ref: { group: "checkout" } }]),
    });
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0]!.testNames, ["Cart > adds"]);
  });

  it("a Group node runs in its group's browsers, a Test node in the project's", async () => {
    const h = harness();
    await runFlowInProject({
      ...h.options,
      flow: chain([
        { id: "g", kind: "group", ref: { group: "cross" } },
        {
          id: "t",
          kind: "test",
          ref: { testId: "checkout/cart.spec.ts::Cart > adds" },
        },
      ]),
    });
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls[0]!.browsers, ["firefox", "chrome"]);
    assert.equal(h.calls[1]!.browsers, undefined);
  });

  it("a group with no tests passes with a note and runs nothing", async () => {
    const h = harness();
    const summary = await runFlowInProject({
      ...h.options,
      flow: chain([{ id: "g", kind: "group", ref: { group: "empty" } }]),
    });
    assert.equal(h.calls.length, 0);
    assert.equal(summary.nodes.g!.note, "This group has no tests.");
    assert.equal(summary.status, "passed");
  });

  it("a failed run fails the node; an aborted one cancels the flow", async () => {
    const failing = harness({
      testRunner: (async () => ({
        status: "failed",
      })) as unknown as typeof runTests,
    });
    const flow = chain([
      { id: "t", kind: "test", ref: { testId: "login.spec.ts::works" } },
    ]);
    const failed = await runFlowInProject({ ...failing.options, flow });
    assert.equal(failed.nodes.t!.error, "A test failed.");
    assert.equal(failed.status, "failed");

    const controller = new AbortController();
    const cancelling = harness({
      signal: controller.signal,
      testRunner: (async () => {
        controller.abort();
        return { status: "failed" };
      }) as unknown as typeof runTests,
    });
    const cancelled = await runFlowInProject({ ...cancelling.options, flow });
    assert.equal(cancelled.status, "cancelled");
  });

  it("a run whose tests were skipped passes the node; a failure beside a skip fails it", async () => {
    const flow = chain([
      { id: "t", kind: "test", ref: { testId: "login.spec.ts::works" } },
    ]);
    const skipped = await runFlowInProject({
      ...harness({
        testRunner: (async () => ({
          status: "success",
          tests: [{ name: "works", status: "skipped" }],
        })) as unknown as typeof runTests,
      }).options,
      flow,
    });
    assert.equal(skipped.nodes.t!.status, "passed");

    const failing = await runFlowInProject({
      ...harness({
        testRunner: (async () => ({
          status: "failed",
          tests: [
            { name: "a", status: "skipped" },
            { name: "b", status: "failed" },
          ],
        })) as unknown as typeof runTests,
      }).options,
      flow,
    });
    assert.equal(failing.nodes.t!.status, "failed");
  });

  it("expressions see the environment's variables", async () => {
    const h = harness({ environment: "staging" });
    const summary = await runFlowInProject({
      ...h.options,
      flow: chain([
        {
          id: "set",
          kind: "set-variable",
          config: { name: "r", value: "env.region" },
        },
      ]),
    });
    assert.deepEqual(summary.vars, { r: "eu" });
  });

  describe("with workers", () => {
    /** A pool that answers every item with `status`, and remembers what it was asked */
    type Status = "success" | "failed" | "skipped";
    function fakePool(
      status: Status | ((item: WorkItem) => Status) = "success",
    ) {
      const state = {
        created: [] as PoolOptions[],
        runs: [] as WorkItem[][],
        disposed: 0,
      };
      const createPool = (options: PoolOptions) => {
        state.created.push(options);
        return {
          async run(items: WorkItem[], hooks: RunHooks = {}) {
            state.runs.push(items);
            return items.map((item) => {
              const outcome =
                typeof status === "function" ? status(item) : status;
              const result = {
                name: item.testName,
                file: item.file,
                browser: item.browser,
                startTime: 0,
                duration: outcome === "skipped" ? 0 : 1,
                status: outcome,
                ...(outcome === "failed" && {
                  message: "no",
                  type: "error" as const,
                }),
                ...(outcome === "skipped" && { annotation: "skip" as const }),
              } as TestResult;
              hooks.onEvent?.({ type: "test-start", item, worker: 0 });
              hooks.onEvent?.({ type: "test-end", item, worker: 0, result });
              return result;
            });
          },
          async dispose() {
            state.disposed++;
          },
        };
      };
      return { state, createPool };
    }
    const real = (p: string) => path.join(realpathSync(dir), p);
    const login = {
      id: "t",
      kind: "test",
      ref: { testId: "login.spec.ts::works" },
    };

    it("runs the tests on one pool built from the run options, and disposes it", async () => {
      const h = harness();
      const pool = fakePool();
      const summary = await runFlowInProject({
        ...h.options,
        workers: 3,
        port: 9300,
        headless: true,
        timeout: 5000,
        environment: "staging",
        createPool: pool.createPool,
        flow: chain([
          login,
          {
            id: "g",
            kind: "group",
            ref: { group: "checkout" },
          },
        ]),
      });
      assert.equal(summary.status, "passed");
      assert.equal(h.calls.length, 0, "runTests is not used");
      assert.equal(pool.state.created.length, 1, "one pool for the run");
      const options = pool.state.created[0]!;
      assert.equal(options.workers, 3);
      assert.equal(options.init.basePort, 9300);
      assert.equal(options.init.headless, true);
      assert.equal(options.init.timeout, 5000);
      assert.equal(options.init.environment, "staging");
      assert.equal(options.init.projectDir, path.resolve(dir));
      assert.deepEqual([...options.init.files].sort(), [
        real("src/checkout/cart.spec.ts"),
        real("src/login.spec.ts"),
      ]);
      assert.equal(pool.state.disposed, 1);
    });

    it("builds one item per test and browser, the group's browsers one after the other", async () => {
      const pool = fakePool();
      await runFlowInProject({
        ...harness().options,
        workers: 2,
        createPool: pool.createPool,
        flow: chain([
          login,
          { id: "g", kind: "group", ref: { group: "cross" } },
        ]),
      });
      const [first, second] = pool.state.runs;
      assert.deepEqual(first, [
        {
          index: 0,
          file: real("src/login.spec.ts"),
          testName: "works",
          browser: "firefox",
        },
      ]);
      assert.deepEqual(
        second!.map((i) => [i.index, i.testName, i.browser]),
        [
          [0, "Cart > adds", "firefox"],
          [1, "Cart > adds", "chrome"],
        ],
      );
    });

    it("reports the pool's events as test events of the node", async () => {
      const h = harness();
      await runFlowInProject({
        ...h.options,
        workers: 2,
        createPool: fakePool().createPool,
        flow: chain([login]),
      });
      const tests = h.events.flatMap((e) =>
        e.type === "test" ? [[e.nodeId, e.event.type]] : [],
      );
      assert.deepEqual(tests, [
        ["t", "test-start"],
        ["t", "test-end"],
      ]);
      const end = h.events.find(
        (e) => e.type === "test" && e.event.type === "test-end",
      ) as { event: { name: string; browser: string; file: string } };
      assert.equal(end.event.name, "works");
      assert.equal(end.event.browser, "firefox");
      assert.equal(end.event.file, real("src/login.spec.ts"));
    });

    it("a failed test fails the node; an aborted run cancels the flow", async () => {
      const flow = chain([login]);
      const failed = await runFlowInProject({
        ...harness().options,
        workers: 2,
        createPool: fakePool("failed").createPool,
        flow,
      });
      assert.equal(failed.nodes.t!.error, "A test failed.");

      const controller = new AbortController();
      const pool = fakePool();
      const cancelled = await runFlowInProject({
        ...harness().options,
        workers: 2,
        signal: controller.signal,
        createPool: (options) => {
          const inner = pool.createPool(options);
          return {
            dispose: inner.dispose,
            async run(items, hooks) {
              controller.abort();
              return inner.run(items, hooks);
            },
          };
        },
        flow,
      });
      assert.equal(cancelled.status, "cancelled");
      assert.equal(pool.state.disposed, 1);
    });

    it("skipped tests do not fail a node: all skipped or skipped with passed is passed, any failure fails it", async () => {
      const group = { id: "g", kind: "group", ref: { group: "cross" } };
      const run = (status: Status | ((item: WorkItem) => Status)) =>
        runFlowInProject({
          ...harness().options,
          workers: 2,
          createPool: fakePool(status).createPool,
          flow: chain([group]),
        });

      const allSkipped = await run("skipped");
      assert.equal(allSkipped.nodes.g!.status, "passed");
      assert.equal(allSkipped.status, "passed");

      const mixed = await run((item) =>
        item.browser === "firefox" ? "skipped" : "success",
      );
      assert.equal(mixed.nodes.g!.status, "passed");

      const withFailure = await run((item) =>
        item.browser === "firefox" ? "skipped" : "failed",
      );
      assert.equal(withFailure.nodes.g!.status, "failed");
      assert.equal(withFailure.nodes.g!.error, "A test failed.");
    });

    it("the skipped test-end reaches the node's events unchanged", async () => {
      const h = harness();
      await runFlowInProject({
        ...h.options,
        workers: 2,
        createPool: fakePool("skipped").createPool,
        flow: chain([login]),
      });
      const end = h.events.find(
        (e) => e.type === "test" && e.event.type === "test-end",
      ) as { event: { result: { status: string; annotation: string } } };
      assert.equal(end.event.result.status, "skipped");
      assert.equal(end.event.result.annotation, "skip");
    });

    it("a pool that rejects fails the node, and is still disposed", async () => {
      let disposed = 0;
      const summary = await runFlowInProject({
        ...harness().options,
        workers: 2,
        createPool: () => ({
          run: async () => {
            throw new Error("The worker failed to start");
          },
          dispose: async () => void disposed++,
        }),
        flow: chain([login]),
      });
      assert.equal(summary.nodes.t!.error, "The worker failed to start");
      assert.equal(disposed, 1);
    });

    it("with one worker there is no pool and runTests is used", async () => {
      const h = harness();
      const pool = fakePool();
      await runFlowInProject({
        ...h.options,
        workers: 1,
        createPool: pool.createPool,
        flow: chain([login]),
      });
      assert.equal(pool.state.created.length, 0);
      assert.equal(h.calls.length, 1);
    });
  });

  it("a flow read by id gets its id from the file name", async () => {
    writeFileSync(
      path.join(dir, "flows/smoke.flow.json"),
      JSON.stringify(chain([{ id: "w", kind: "wait", config: { ms: 1 } }])),
    );
    const summary = await runFlowInProject({
      ...harness().options,
      flowId: "smoke",
    });
    assert.equal(summary.status, "passed");
  });

  it("an unreadable flow file is a clear error", async () => {
    writeFileSync(path.join(dir, "flows/broken.flow.json"), "{ nope");
    await assert.rejects(
      runFlowInProject({ ...harness().options, flowId: "broken" }),
      /Couldn't read the flow "broken"/,
    );
  });

  describe("environment choice", () => {
    const flow = chain([], { envDefault: "staging" });
    const names = (c: SamuraiTestConfig, f = flow, option?: string) =>
      chooseEnvironment(c, f, option);

    it("option, else envDefault, else defaultEnvironment, else the first, else default", () => {
      assert.equal(names(config, flow, "dev"), "dev");
      assert.equal(names(config), "staging");
      assert.equal(names(config, chain([])), "dev");
      assert.equal(
        names({ environments: config.environments }, chain([])),
        "dev",
      );
      assert.equal(names({}, chain([])), "default");
    });

    it("an envDefault the project lacks is passed over", () => {
      assert.equal(names(config, chain([], { envDefault: "gone" })), "dev");
    });

    it("the run uses the chosen environment", async () => {
      const h = harness();
      const summary = await runFlowInProject({
        ...h.options,
        flow: chain(
          [
            {
              id: "set",
              kind: "set-variable",
              config: { name: "r", value: "env.region" },
            },
          ],
          { envDefault: "staging" },
        ),
      });
      assert.deepEqual(summary.vars, { r: "eu" });
      assert.equal(
        (h.events[0] as { environment: string }).environment,
        "staging",
      );
    });

    it("an environment the project lacks is refused", async () => {
      await assert.rejects(
        runFlowInProject({
          ...harness().options,
          environment: "nope",
          flow: chain([]),
        }),
        /Unknown environment "nope"/,
      );
    });
  });

  describe("checks before starting", () => {
    it("a deleted test is a check error and nothing runs", async () => {
      const h = harness();
      await assert.rejects(
        runFlowInProject({
          ...h.options,
          flow: chain([
            { id: "t", kind: "test", ref: { testId: "login.spec.ts::gone" } },
          ]),
        }),
        (e: unknown) => {
          assert.ok(e instanceof FlowCheckError);
          assert.match(e.message, /deleted or moved/);
          assert.equal(e.problems.length, 1);
          return true;
        },
      );
      assert.equal(h.calls.length, 0);
      assert.deepEqual(h.events, []);
    });

    it("an unknown group and a bad expression are listed together", async () => {
      await assert.rejects(
        runFlowInProject({
          ...harness().options,
          flow: chain([
            { id: "g", kind: "group", ref: { group: "nope" } },
            { id: "c", kind: "wait", config: { ms: 1 } },
            {
              id: "s",
              kind: "set-variable",
              config: { name: "x", value: "env.missing" },
            },
          ]),
        }),
        (e: unknown) => {
          assert.ok(e instanceof FlowCheckError);
          assert.equal(e.problems.length, 2);
          return true;
        },
      );
    });
  });

  it("each Test node is its own project session: nodes run one after the other", async () => {
    const h = harness();
    const summary = await runFlowInProject({
      ...h.options,
      flow: chain([
        { id: "a", kind: "test", ref: { testId: "login.spec.ts::works" } },
        {
          id: "b",
          kind: "test",
          ref: { testId: "login.spec.ts::fails nicely" },
        },
      ]),
    });
    assert.equal(summary.status, "passed");
    assert.deepEqual(
      h.calls.map((c) => c.testNames),
      [["works"], ["fails nicely"]],
    );
  });
});

describe("project steps", () => {
  const echo = defineStep({
    kind: "echo",
    label: "Echo",
    icon: "code",
    section: "control",
    fields: [
      { path: "config.value", type: "expression", label: "Value", default: "" },
    ],
    outputs: [{ name: "value" }],
    async run({ config }) {
      return { outputs: { value: config.value } };
    },
  });

  it("a project step runs, and a later expression reads its output (Review Focus 4)", async () => {
    const h = harness({ config: { ...config, steps: [echo] } });
    const summary = await runFlowInProject({
      ...h.options,
      flow: chain([
        { id: "e", kind: "echo", config: { value: '"hi " + env.region' } },
        {
          id: "s",
          kind: "set-variable",
          config: { name: "said", value: "nodes.e.value" },
        },
      ]),
    });
    assert.equal(summary.status, "passed");
    assert.deepEqual(summary.nodes.e!.outputs, { value: "hi us" });
    assert.deepEqual(summary.vars, { said: "hi us" });
  });

  it("without the step in the config, its kind is a check error", async () => {
    await assert.rejects(
      runFlowInProject({
        ...harness().options,
        flow: chain([{ id: "e", kind: "echo", config: { value: "1" } }]),
      }),
      FlowCheckError,
    );
  });

  it("a collision refuses the run", async () => {
    await assert.rejects(
      runFlowInProject({
        ...harness({ config: { ...config, steps: [{ ...echo, kind: "api" }] } })
          .options,
        flow: chain([]),
      }),
      /a built-in step already uses this kind/,
    );
  });
});

describe("nodeTestsOf", () => {
  const tests = [
    { id: "a.spec.ts::one", file: "/p/a.spec.ts", name: "one" },
    { id: "a.spec.ts::two", file: "/p/a.spec.ts", name: "two" },
  ];
  const groups = [
    {
      name: "cross",
      testIds: ["a.spec.ts::one", "a.spec.ts::gone"],
      browsers: ["firefox", "chrome"] as ("firefox" | "chrome")[],
    },
  ];
  const flow = {
    nodes: [
      { id: "t", kind: "test", ref: { testId: "a.spec.ts::two" } },
      { id: "g", kind: "group", ref: { group: "cross" } },
      { id: "m", kind: "group", ref: { group: "missing" } },
      { id: "w", kind: "wait" },
    ],
  } as unknown as Parameters<typeof nodeTestsOf>[0];

  it("lists the tests of each Test and Group node, leaving out tests that no longer exist", () => {
    const { nodeTests } = nodeTestsOf(flow, tests, groups);
    assert.deepEqual(nodeTests, {
      t: [{ file: "/p/a.spec.ts", name: "two" }],
      g: [{ file: "/p/a.spec.ts", name: "one" }],
      m: [],
    });
  });

  it("gives a Group node its group's browsers and every other node none", () => {
    const { nodeBrowsers } = nodeTestsOf(flow, tests, groups);
    assert.deepEqual(nodeBrowsers, { g: ["firefox", "chrome"] });
  });
});
