import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TestFixtures } from "../types/test.js";
import { extendLayers } from "./fixture-defs.js";
import { FixtureScope } from "./fixture-scope.js";
import { WorkerFixtures } from "./fixture-worker.js";

const builtIn = { baseURL: "http://x" } as unknown as TestFixtures;
const body = (fn: (f: any) => unknown) => fn as (...a: never[]) => unknown;
const scopeOf = (defs: object, workers?: WorkerFixtures) =>
  new FixtureScope(extendLayers(undefined, defs), builtIn, {
    ...(workers && { workers }),
  });

describe("what a scope reports about its fixtures", () => {
  it("lists every fixture that has a setup, in the order they were set up, with its status and time", async () => {
    const scope = scopeOf({
      plain: 7,
      leaf: async ({}: any, use: any) => {
        await new Promise((r) => setTimeout(r, 20));
        await use(1);
      },
      top: async ({ leaf }: any, use: any) => use(leaf),
    });
    await scope.prepare(body(async ({ top, plain }: any) => [top, plain]));
    await scope.teardown(1000);
    const report = scope.report();
    assert.deepEqual(
      report.map((e) => [e.name, e.scope, e.setup.status, e.teardown?.status]),
      [
        ["leaf", "test", "passed", "passed"],
        ["top", "test", "passed", "passed"],
      ],
    );
    assert.ok(report[0]!.setup.durationMs >= 15);
    assert.equal(typeof report[0]!.teardown!.durationMs, "number");
  });

  it("nothing is reported for a scope that set no fixture up", async () => {
    const scope = scopeOf({ a: async ({}: any, use: any) => use(1), v: 2 });
    await scope.prepare(body(async ({ v }: any) => v));
    assert.deepEqual(scope.report(), []);
  });

  it("lists the declared outputs that are not secret, and never the secret ones", async () => {
    const scope = scopeOf({
      order: [
        async ({}: any, use: any) =>
          use({
            id: "o-1",
            total: 20,
            paid: true,
            token: "s3cret",
            extra: "x",
          }),
        {
          outputs: [
            { name: "id" },
            { name: "total" },
            { name: "paid" },
            { name: "token", secret: true },
          ],
        },
      ],
    });
    await scope.prepare(body(async ({ order }: any) => order));
    assert.deepEqual(scope.report()[0]!.outputs, {
      id: "o-1",
      total: 20,
      paid: true,
    });
    assert.equal((scope.fixtures as any).order.token, "s3cret");
    assert.equal(JSON.stringify(scope.report()).includes("s3cret"), false);
  });

  it("an output that is not a string, number or boolean fails the setup", async () => {
    const scope = scopeOf({
      order: [
        async ({}: any, use: any) => use({ id: { nested: 1 } }),
        { outputs: [{ name: "id" }] },
      ],
    });
    await assert.rejects(
      scope.prepare(body(async ({ order }: any) => order)),
      /fixture "order" setup failed: output "id" must be a string, number or boolean/,
    );
    assert.equal(scope.report()[0]!.setup.status, "failed");
    await scope.teardown(1000);
  });

  it("a failed setup and a failed teardown carry their error", async () => {
    const scope = scopeOf({
      broken: async ({}: any, use: any) => {
        throw new Error("no luck");
      },
      messy: async ({}: any, use: any) => {
        await use(1);
        throw new Error("cleanup broke");
      },
    });
    await scope.prepare(body(async ({ messy }: any) => messy));
    await assert.rejects(
      scope.prepare(body(async ({ broken }: any) => broken)),
    );
    const error = await scope.teardown(1000);
    assert.match(
      error!.message,
      /fixture "messy" teardown failed: cleanup broke/,
    );
    const [messy, broken] = scope.report();
    assert.equal(messy!.name, "messy");
    assert.equal(messy!.teardown!.status, "failed");
    assert.equal(
      messy!.teardown!.error!.message,
      'fixture "messy" teardown failed: cleanup broke',
    );
    assert.equal(broken!.setup.status, "failed");
    assert.equal(
      broken!.setup.error!.message,
      'fixture "broken" setup failed: no luck',
    );
    assert.equal(broken!.teardown, undefined);
  });

  it("a worker fixture is reported as set up by the first test and skipped by the next", async () => {
    const workers = new WorkerFixtures(1000);
    const defs = {
      seed: [
        async ({}: any, use: any) => use({ id: 1 }),
        { scope: "worker", outputs: [{ name: "id" }] },
      ],
    };
    const first = scopeOf(defs, workers);
    await first.prepare(body(async ({ seed }: any) => seed));
    await first.teardown(1000);
    const second = new FixtureScope(first["layers"], builtIn, { workers });
    await second.prepare(body(async ({ seed }: any) => seed));
    await second.teardown(1000);
    assert.deepEqual(
      [first.report()[0]!, second.report()[0]!].map((e) => [
        e.scope,
        e.setup.status,
        e.teardown,
        e.outputs,
      ]),
      [
        ["worker", "passed", undefined, { id: 1 }],
        ["worker", "skipped", undefined, { id: 1 }],
      ],
    );
    await workers.closeAll();
  });
});

describe("fixture timeouts", () => {
  it("a setup that outlasts the fixture's timeout fails, and is released if it ever calls use", async () => {
    let finished = false;
    const scope = scopeOf({
      slow: [
        async ({}: any, use: any) => {
          await new Promise((r) => setTimeout(r, 120));
          await use(1);
          finished = true;
        },
        { timeout: 40 },
      ],
    });
    await assert.rejects(
      scope.prepare(body(async ({ slow }: any) => slow)),
      /fixture "slow" setup failed: timed out after 0.04 seconds/,
    );
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(finished, true);
  });

  it("a teardown that hangs is cut off after the fixture's timeout, not the test's", async () => {
    const scope = scopeOf({
      hangs: [
        async ({}: any, use: any) => {
          await use(1);
          await new Promise(() => {});
        },
        { timeout: 30 },
      ],
    });
    await scope.prepare(body(async ({ hangs }: any) => hangs));
    const error = await scope.teardown(60000);
    assert.match(
      error!.message,
      /fixture "hangs" teardown failed: timed out after 0.03 seconds/,
    );
  });
});
