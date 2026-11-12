import assert from "node:assert/strict";
import { realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { PoolOptions, RunHooks } from "../../runner/worker-pool.js";
import type { WorkItem } from "../../runner/worker-protocol.js";
import type { TestResult } from "../../types/test.js";
import { runFlowInProject } from "./project.js";
import { dir, chain, inRun, harness } from "../../testing/flow-project.js";

describe("runFlowInProject", () => {
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
        outputDir: "runs/1",
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
      assert.equal(options.init.outputDir, undefined, "the folder is per node");
      assert.deepEqual(
        pool.state.runs.map((items) => items[0]!.outputDir),
        [
          path.join("runs/1", "firefox", "nodes", login.id),
          path.join("runs/1", "firefox", "nodes", "g"),
        ],
      );
      assert.deepEqual([...options.init.files].sort(), [
        real("src/checkout/cart.spec.ts"),
        real("src/login.spec.ts"),
      ]);
      assert.equal(pool.state.disposed, 1);
    });

    it("builds one item per test, in the run's browser: a node outside it is not run", async () => {
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
      assert.deepEqual(pool.state.runs[0], [
        {
          index: 0,
          file: real("src/login.spec.ts"),
          testName: "works",
          browser: "firefox",
        },
      ]);
      assert.deepEqual(
        pool.state.runs.map((items) =>
          items.map((i) => [i.index, i.testName, i.browser]),
        ),
        [
          [[0, "works", "firefox"]],
          [[0, "Cart > adds", "firefox"]],
          [[0, "Cart > adds", "chrome"]],
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

    it("hands the retries to the workers, and a retried test's start carries its attempt", async () => {
      const h = harness();
      const created: PoolOptions[] = [];
      await runFlowInProject({
        ...h.options,
        workers: 2,
        retries: "2",
        createPool: (options) => {
          created.push(options);
          return {
            async run(items: WorkItem[], hooks: RunHooks = {}) {
              const item = items[0]!;
              hooks.onEvent?.({ type: "test-start", item, worker: 0 });
              hooks.onEvent?.({
                type: "test-start",
                item,
                worker: 0,
                retry: 1,
              });
              const result = {
                name: item.testName,
                file: item.file,
                browser: item.browser,
                startTime: 0,
                duration: 1,
                status: "success",
                retry: 1,
                flaky: true,
              } as TestResult;
              hooks.onEvent?.({ type: "test-end", item, worker: 0, result });
              return [result];
            },
            async dispose() {},
          };
        },
        flow: chain([login]),
      });
      assert.equal(created[0]?.init.retries, 2);
      const starts = h.events.flatMap((e) =>
        e.type === "test" && e.event.type === "test-start"
          ? [(e.event as { retry?: number }).retry]
          : [],
      );
      assert.deepEqual(starts, [undefined, 1]);
    });

    it("a failed test fails the node; an aborted run cancels the flow", async () => {
      const flow = chain([login]);
      const failed = await runFlowInProject({
        ...harness().options,
        workers: 2,
        createPool: fakePool("failed").createPool,
        flow,
      });
      assert.equal(inRun(failed).nodes.t!.error, "A test failed.");

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
      assert.equal(inRun(allSkipped).nodes.g!.status, "passed");
      assert.equal(allSkipped.status, "passed");

      const mixed = await run((item) =>
        item.browser === "firefox" ? "skipped" : "success",
      );
      assert.equal(inRun(mixed).nodes.g!.status, "passed");

      const withFailure = await run((item) =>
        item.browser === "firefox" ? "skipped" : "failed",
      );
      assert.equal(inRun(withFailure).nodes.g!.status, "passed");
      assert.equal(inRun(withFailure, "chrome").nodes.g!.status, "failed");
      assert.equal(
        inRun(withFailure, "chrome").nodes.g!.error,
        "A test failed.",
      );
      assert.equal(withFailure.status, "failed");
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
      assert.equal(inRun(summary).nodes.t!.error, "The worker failed to start");
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
      /Couldn’t read the flow "broken"/,
    );
  });
});
