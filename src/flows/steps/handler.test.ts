import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowFile } from "../core/index.js";
import { runFlow } from "../run/run.js";
import { defineStep, stepNode, type StepDefinition } from "./define.js";
import { stepHandler } from "./handler.js";
import { HANDLERS } from "../run/handlers/index.js";

const echo = defineStep({
  kind: "echo",
  label: "Echo",
  icon: "code",
  section: "control",
  fields: [
    { path: "config.value", type: "expression", label: "Value", default: "" },
    { path: "config.name", type: "text", label: "Name", default: "" },
  ],
  outputs: [{ name: "value" }],
  writesVar: "config.name",
  async run({ config }) {
    return { outputs: { value: config.value }, ...(config.name ? { vars: { [config.name]: config.value } } : {}) };
  },
});

const at = (id: string, kind: string, config?: Record<string, unknown>) => ({
  id, key: id, kind, onFailure: "stop" as const, position: { x: 0, y: 0 }, ...(config ? { config } : {}),
});
const chain = (...nodes: ReturnType<typeof at>[]): FlowFile => ({
  id: "f", name: "f", nodes: [at("start", "start"), ...nodes, at("end", "end")],
  edges: ["start", ...nodes.map((n) => n.id), "end"].slice(1).map((id, i, all) => ({
    id: `e${i}`, source: i === 0 ? "start" : all[i - 1]!, target: id,
  })),
});
const run = (flow: FlowFile, // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: StepDefinition<any>[] = [echo], signal?: AbortSignal) =>
  runFlow({
    flow,
    nodeTests: {},
    environment: { name: "dev", variables: { base: 2 } },
    runTests: async () => "passed",
    sleep: async () => {},
    handlers: { ...HANDLERS, ...Object.fromEntries(steps.map((s) => [s.kind, stepHandler(s)])) },
    nodes: steps.map(stepNode),
    ...(signal && { signal }),
  });

describe("defineStep", () => {
  const base = { label: "X", icon: "code", section: "control" as const, fields: [], run: async () => {} };
  test("refuses closed kinds, bad names, non-config paths, reserved and duplicate outputs, a writesVar that isn't a field", () => {
    assert.throws(() => defineStep({ ...base, kind: "condition" }), /closed kind/);
    assert.throws(() => defineStep({ ...base, kind: "Bad_Kind" }), /isn't a valid step kind/);
    assert.throws(() => defineStep({ ...base, kind: "x", fields: [{ path: "title", type: "text" }] }), /config\./);
    assert.throws(() => defineStep({ ...base, kind: "x", outputs: [{ name: "status" }] }), /reserved/);
    assert.throws(() => defineStep({ ...base, kind: "x", outputs: [{ name: "a" }, { name: "a" }] }), /twice/);
    assert.throws(() => defineStep({ ...base, kind: "x", writesVar: "config.nope" }), /writesVar/);
    assert.throws(
      () => defineStep({ ...base, kind: "x", fields: [{ path: "config.a", type: "text", pattern: "(" }] }),
      /valid regular expression/,
    );
  });
});

describe("stepHandler", () => {
  test("expressions are evaluated; outputs land in nodes.<key>; vars only through writesVar", async () => {
    const flow = chain(
      at("a", "echo", { value: "env.base * 2", name: "n" }),
      at("b", "echo", { value: "nodes.a.value + vars.n", name: "" }),
    );
    const s = await run(flow);
    assert.equal(s.status, "passed");
    assert.equal(s.nodes.a!.status, "passed");
    assert.deepEqual(s.nodes.a!.outputs, { value: 4 });
    assert.deepEqual(s.nodes.a!.wrote, { n: 4 });
    assert.equal(s.nodes.b!.outputs!.value, 8);
    assert.deepEqual(s.vars, { n: 4 });
  });

  test("a throw fails the node with its message", async () => {
    const boom = defineStep({ kind: "boom", label: "Boom", icon: "code", section: "control", fields: [],
      async run() { throw new Error("no luck"); } });
    const s = await run(chain(at("x", "boom")), [boom]);
    assert.equal(s.nodes.x!.status, "failed");
    assert.equal(s.nodes.x!.error, "no luck");
  });

  test("undeclared outputs and variables fail the node", async () => {
    const sneaky = defineStep({ kind: "sneaky", label: "Sneaky", icon: "code", section: "control", fields: [],
      async run() { return { outputs: { other: 1 } }; } });
    const s = await run(chain(at("x", "sneaky")), [sneaky]);
    assert.equal(s.nodes.x!.error, "Sneaky returned outputs it doesn't declare: other.");
  });

  test("a step that ignores the stop signal still ends cancelled at once (Review Focus 1)", async () => {
    const stuck = defineStep({ kind: "stuck", label: "Stuck", icon: "code", section: "control", fields: [],
      run: () => new Promise(() => {}) });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 20);
    const began = Date.now();
    const s = await run(chain(at("x", "stuck")), [stuck], abort.signal);
    assert.equal(s.status, "cancelled");
    assert.ok(Date.now() - began < 1000);
  });
});
