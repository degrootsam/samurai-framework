import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { FlowFile } from "../core/index.js";
import type { SamuraiTestConfig } from "../../types/config.js";
import type { runTests } from "../../runner/run.js";
import type { FlowEvent } from "./events.js";
import {
  FlowCheckError,
  chooseEnvironment,
  runFlowInProject,
  type RunFlowInProjectOptions,
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
    assert.deepEqual(h.calls[0]!.files, [
      path.join(dir, "src/checkout/cart.spec.ts"),
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

    const withApi = () =>
      chain([
        { id: "http", kind: "api" },
        { id: "w", kind: "wait", config: { ms: 1 } },
      ]);

    it('unsupported "fail" (default) refuses a flow with an HTTP node', async () => {
      const h = harness();
      await assert.rejects(
        runFlowInProject({ ...h.options, flow: withApi() }),
        (e: unknown) =>
          e instanceof FlowCheckError && /can't run yet/.test(e.message),
      );
      assert.deepEqual(h.events, []);
    });

    it('unsupported "skip" skips the node and the flow can pass', async () => {
      const summary = await runFlowInProject({
        ...harness().options,
        unsupported: "skip",
        flow: withApi(),
      });
      assert.equal(summary.nodes.http!.status, "skipped");
      assert.equal(summary.nodes.http!.note, "Not supported yet");
      assert.equal(summary.status, "passed");
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
