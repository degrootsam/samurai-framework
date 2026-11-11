import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import type { SamuraiTestConfig } from "../../types/config.js";
import type { runTests } from "../../runner/run.js";
import {
  FlowCheckError,
  chooseEnvironment,
  runFlowInProject,
} from "./project.js";
import {
  dir,
  config,
  chain,
  inRun,
  harness,
} from "../../testing/flow-project.js";

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

  it("gives each node its own folder under outputDir", async () => {
    const h = harness();
    const outputDir = path.resolve("/runs/1");
    await runFlowInProject({
      ...h.options,
      outputDir,
      flow: chain([
        { id: "t", kind: "test", ref: { testId: "login.spec.ts::works" } },
      ]),
    });
    assert.equal(
      h.calls[0]!.outputDir,
      path.join(outputDir, "firefox", "nodes", "t"),
    );
  });

  it("without outputDir, node runs keep the default folder", async () => {
    const h = harness();
    await runFlowInProject({
      ...h.options,
      flow: chain([
        { id: "t", kind: "test", ref: { testId: "login.spec.ts::works" } },
      ]),
    });
    assert.ok(!("outputDir" in h.calls[0]!));
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
    const result = await runFlowInProject({
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
    assert.deepEqual(
      h.calls.map((c) => c.browsers),
      [["firefox"], ["firefox"], ["chrome"]],
    );
    assert.deepEqual(inRun(result, "chrome").nodes.t, {
      status: "skipped",
      note: "not run in chrome",
      durationMs: inRun(result, "chrome").nodes.t!.durationMs,
    });
  });

  it("a group with no tests passes with a note and runs nothing", async () => {
    const h = harness();
    const summary = await runFlowInProject({
      ...h.options,
      flow: chain([{ id: "g", kind: "group", ref: { group: "empty" } }]),
    });
    assert.equal(h.calls.length, 0);
    assert.equal(inRun(summary).nodes.g!.note, "This group has no tests.");
    assert.equal(summary.status, "passed");
  });

  it("passes the retries (the option, else SAMURAI_RETRIES, else the config's) to the run of a node", async () => {
    const withOption = harness();
    await runFlowInProject({
      ...withOption.options,
      retries: 1,
      flow: chain([
        { id: "t", kind: "test", ref: { testId: "login.spec.ts::works" } },
      ]),
    });
    assert.equal(withOption.calls[0]?.retries, 1);

    const withConfig = harness({ config: { ...config, retries: 3 } });
    await runFlowInProject({
      ...withConfig.options,
      retriesEnv: "2",
      flow: chain([
        { id: "t", kind: "test", ref: { testId: "login.spec.ts::works" } },
      ]),
    });
    assert.equal(
      withConfig.calls[0]?.retries,
      2,
      "the variable beats the config",
    );

    const none = harness();
    await runFlowInProject({
      ...none.options,
      flow: chain([
        { id: "t", kind: "test", ref: { testId: "login.spec.ts::works" } },
      ]),
    });
    assert.equal(
      none.calls[0]?.retries,
      undefined,
      "no retries: the option is left out",
    );
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
    assert.equal(inRun(failed).nodes.t!.error, "A test failed.");
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
    assert.equal(inRun(skipped).nodes.t!.status, "passed");

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
    assert.equal(inRun(failing).nodes.t!.status, "failed");
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
    assert.deepEqual(inRun(summary).vars, { r: "eu" });
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
      assert.deepEqual(inRun(summary).vars, { r: "eu" });
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
