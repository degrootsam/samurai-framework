import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TestFixtures } from "../types/test.js";
import { extendLayers } from "./fixture-defs.js";
import { FixtureScope, type ScopeRun } from "./fixture-scope.js";
import { WorkerFixtures } from "./fixture-worker.js";

const builtIn = {
  baseURL: "http://x",
  browserName: "firefox",
  workerIndex: 0,
} as unknown as TestFixtures;
const body = (fn: (f: any) => unknown) => fn as (...a: never[]) => unknown;

/** A worker fixture that logs setup and teardown and hands out a counter */
function project(log: string[]) {
  let made = 0;
  return extendLayers(undefined, {
    seedOptions: [{ size: 1 }, { option: true }],
    seed: [
      async ({ seedOptions }: any, use: any) => {
        const id = ++made;
        log.push(`+seed${id}(${seedOptions.size})`);
        await use({ id });
        log.push(`-seed${id}`);
      },
      { scope: "worker" },
    ],
    row: async ({ seed }: any, use: any) => {
      log.push(`+row(${seed.id})`);
      await use(seed.id);
      log.push("-row");
    },
  });
}

const scopeFor = (
  layers: ReturnType<typeof project>,
  workers: WorkerFixtures,
  run: ScopeRun = {},
) => new FixtureScope(layers, builtIn, { workers, environment: "dev", ...run });

describe("worker-scoped fixtures", () => {
  it("are set up once for the tests of a worker and torn down when the worker is done", async () => {
    const log: string[] = [];
    const layers = project(log);
    const workers = new WorkerFixtures(1000);
    for (const n of [1, 2]) {
      const scope = scopeFor(layers, workers);
      await scope.prepare(body(async ({ seed }: any) => seed));
      assert.equal((scope.fixtures as any).seed.id, 1, `test ${n}`);
      assert.equal(await scope.teardown(1000), undefined);
    }
    assert.deepEqual(log, ["+seed1(1)"]);
    assert.deepEqual(await workers.closeAll(), []);
    assert.deepEqual(log, ["+seed1(1)", "-seed1"]);
    assert.deepEqual(await workers.closeAll(), []);
  });

  it("a test-scoped fixture may depend on one, and is torn down with its test", async () => {
    const log: string[] = [];
    const layers = project(log);
    const workers = new WorkerFixtures(1000);
    const scope = scopeFor(layers, workers);
    await scope.prepare(body(async ({ row }: any) => row));
    await scope.teardown(1000);
    assert.deepEqual(log, ["+seed1(1)", "+row(1)", "-row"]);
    await workers.closeAll();
  });

  it("different options or another environment get an instance of their own", async () => {
    const log: string[] = [];
    const layers = project(log);
    const workers = new WorkerFixtures(1000);
    const ids: number[] = [];
    for (const run of [
      {},
      { options: { seedOptions: { size: 1 } } },
      { options: { seedOptions: { size: 2 } } },
      { options: { seedOptions: { size: 2 } } },
      { environment: "staging" },
    ] as ScopeRun[]) {
      const scope = scopeFor(layers, workers, run);
      await scope.prepare(body(async ({ seed }: any) => seed));
      ids.push((scope.fixtures as any).seed.id);
      await scope.teardown(1000);
    }
    // {} and { size: 1 } are the same options, { size: 2 } twice shares, staging is separate
    assert.deepEqual(ids, [1, 1, 2, 2, 3]);
    await workers.closeAll();
    assert.deepEqual(
      log.filter((l) => l.startsWith("-")),
      ["-seed3", "-seed2", "-seed1"],
    );
  });

  it("a setup that failed is not kept: the next test tries again", async () => {
    let tries = 0;
    const layers = extendLayers(undefined, {
      flaky: [
        async ({}: any, use: any) => {
          if (++tries === 1) throw new Error("not yet");
          await use(tries);
        },
        { scope: "worker" },
      ],
    });
    const workers = new WorkerFixtures(1000);
    const first = scopeFor(layers as never, workers);
    await assert.rejects(
      first.prepare(body(async ({ flaky }: any) => flaky)),
      /fixture "flaky" setup failed: not yet/,
    );
    const second = scopeFor(layers as never, workers);
    await second.prepare(body(async ({ flaky }: any) => flaky));
    assert.equal((second.fixtures as any).flaky, 2);
    await workers.closeAll();
  });

  it("closeAll tears down last-first within each fixture's timeout and returns the errors", async () => {
    const layers = extendLayers(undefined, {
      a: [
        async ({}: any, use: any) => {
          await use(1);
          throw new Error("a broke");
        },
        { scope: "worker" },
      ],
      b: [
        async ({ a }: any, use: any) => {
          await use(a);
          await new Promise(() => {});
        },
        { scope: "worker", timeout: 50 },
      ],
    });
    const workers = new WorkerFixtures(1000);
    const scope = scopeFor(layers as never, workers);
    await scope.prepare(body(async ({ b }: any) => b));
    await scope.teardown(1000);
    const errors = await workers.closeAll();
    assert.deepEqual(
      errors.map((e) => e.message),
      [
        'fixture "b" teardown failed: timed out after 0.05 seconds',
        'fixture "a" teardown failed: a broke',
      ],
    );
  });

  it("without a pool of the worker they live as long as the scope", async () => {
    const log: string[] = [];
    const scope = new FixtureScope(project(log), builtIn);
    await scope.prepare(body(async ({ seed }: any) => seed));
    await scope.teardown(1000);
    assert.deepEqual(log, ["+seed1(1)", "-seed1"]);
  });
});
