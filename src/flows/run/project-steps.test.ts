import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineStep } from "../steps/index.js";
import { FlowCheckError, runFlowInProject, nodeTestsOf } from "./project.js";
import { config, chain, inRun, harness } from "../../testing/flow-project.js";

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
    assert.deepEqual(inRun(summary).nodes.e!.outputs, { value: "hi us" });
    assert.deepEqual(inRun(summary).vars, { said: "hi us" });
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
    const { nodeTests } = nodeTestsOf(flow, tests, groups, ["chrome"]);
    assert.deepEqual(nodeTests, {
      t: [{ file: "/p/a.spec.ts", name: "two" }],
      g: [{ file: "/p/a.spec.ts", name: "one" }],
      m: [],
    });
  });

  it("gives a Group node its group's browsers, a Test node the project's, and every other node none", () => {
    const { nodeBrowsers } = nodeTestsOf(flow, tests, groups, ["chrome"]);
    assert.deepEqual(nodeBrowsers, {
      t: ["chrome"],
      g: ["firefox", "chrome"],
    });
  });
});
