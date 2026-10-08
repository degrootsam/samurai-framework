import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowFile } from "../flows/core/index.js";
import type { FlowEvent } from "../flows/run/events.js";
import { FlowReporter } from "./flow-reporter.js";

const node = (id: string, kind: string, title?: string) => ({
  id,
  kind,
  key: id,
  ...(title && { title }),
  onFailure: "stop" as const,
  position: { x: 0, y: 0 },
});
const flow: FlowFile = {
  id: "checkout",
  name: "Checkout",
  nodes: [
    node("start", "start"),
    node("login", "test", "Login"),
    node("set", "set-variable"),
    node("cond", "condition"),
    node("pay", "test", "Pay"),
    node("verify", "test", "Verify"),
    node("end", "end"),
  ],
  edges: [],
};

function render(color: boolean) {
  let text = "";
  const reporter = new FlowReporter({ flow, write: (t) => (text += t), color });
  const events: FlowEvent[] = [
    { type: "flow-start", environment: "staging" },
    { type: "node-end", nodeId: "start", result: { status: "passed" } },
    {
      type: "node-end",
      nodeId: "login",
      result: { status: "passed", durationMs: 1200 },
    },
    {
      type: "node-end",
      nodeId: "set",
      result: { status: "passed", durationMs: 0, wrote: { order: 1 } },
    },
    {
      type: "node-end",
      nodeId: "cond",
      result: { status: "passed", durationMs: 3, branch: "true" },
    },
    {
      type: "node-end",
      nodeId: "pay",
      result: {
        status: "failed",
        durationMs: 4800,
        error: "expect failed\nsecond",
      },
    },
    {
      type: "node-end",
      nodeId: "verify",
      result: { status: "skipped", note: "Not supported yet" },
    },
    {
      type: "flow-end",
      summary: {
        status: "failed",
        vars: {},
        nodes: {
          start: { status: "passed" },
          login: { status: "passed" },
          set: { status: "passed" },
          cond: { status: "passed" },
          pay: { status: "failed" },
          verify: { status: "skipped" },
          end: { status: "not-run" },
        },
      },
    },
  ];
  for (const e of events) reporter.handle(e);
  return text;
}

describe("FlowReporter", () => {
  it("prints the header, a line per node, errors indented, and the counts", () => {
    const text = render(false);
    assert.match(text, /^Flow "Checkout" against staging\n/);
    assert.match(text, /✔ Login \(1\.2s\)/);
    assert.match(text, /✔ Set variable vars\.order \(0ms\)/);
    assert.match(text, /◇ Condition → true/);
    assert.match(text, /✖ Pay \(4\.8s\)\n {6}expect failed\n {6}second\n/);
    assert.match(text, /⊘ Verify \(skipped: Not supported yet\)/);
    assert.match(text, /1 failed, 3 passed, 1 skipped \(/);
    assert.ok(!text.includes("\u001b"));
    assert.ok(!/Start|End/.test(text.split("\n").slice(1, -3).join("\n")));
  });

  it("counts nodes that did not run, and colours when asked", () => {
    assert.ok(render(true).includes("\u001b[31m"));
    let text = "";
    const r = new FlowReporter({
      flow,
      write: (t) => (text += t),
      color: false,
    });
    r.handle({
      type: "flow-end",
      summary: {
        status: "cancelled",
        vars: {},
        nodes: { login: { status: "not-run" }, pay: { status: "not-run" } },
      },
    });
    assert.match(text, /Cancelled/);
    assert.match(text, /0 passed, 2 not run/);
  });
});
