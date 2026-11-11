import assert from "node:assert/strict";
import type { FlowFile } from "../flows/core/index.js";
import type { FlowEvent, NodeTest } from "../flows/run/events.js";
import { stepNodeOf } from "../flows/core/index.js";
import type { RunFlowOptions } from "../flows/run/run.js";

export const match = (actual: unknown, expected: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(expected))
    assert.deepEqual((actual as Record<string, unknown>)[k], v);
};

export type N = {
  id: string;
  kind: string;
  config?: Record<string, unknown>;
  onFailure?: "stop" | "continue";
  ref?: { testId?: string; group?: string };
};
export const flowOf = (
  nodes: N[],
  edges: [string, string, string?][],
): FlowFile => ({
  id: "f",
  name: "f",
  nodes: nodes.map((n) => ({
    onFailure: "stop",
    position: { x: 0, y: 0 },
    key: n.id,
    ...n,
  })),
  edges: edges.map(([source, target, sourceHandle]) => ({
    id: `${source}-${target}-${sourceHandle ?? ""}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  })),
});
export const t = (name: string): NodeTest => ({ file: "/p/a.spec.ts", name });

export function harness(
  flow: FlowFile,
  results: Record<string, "passed" | "failed"> = {},
  over: Partial<RunFlowOptions> = {},
) {
  const events: FlowEvent[] = [];
  const ran: string[] = [];
  const controller = new AbortController();
  const options: RunFlowOptions = {
    flow,
    nodeTests: Object.fromEntries(
      flow.nodes.filter((n) => n.kind === "test").map((n) => [n.id, [t(n.id)]]),
    ),
    environment: { name: "staging", variables: { region: "eu" } },
    browser: "firefox",
    startedAt: "2026-10-07T10:00:00Z",
    signal: controller.signal,
    onEvent: (e) => events.push(e),
    runTests: async ({ tests }) => {
      ran.push(...tests.map((x) => x.name));
      return tests.some((x) => results[x.name] === "failed")
        ? "failed"
        : "passed";
    },
    sleep: async () => {},
    ...over,
  };
  return { options, events, ran, controller };
}

export const chain = (...ids: string[]) =>
  ids.slice(1).map((id, i) => [ids[i], id] as [string, string]);

export const ghost = stepNodeOf({
  kind: "ghost",
  label: "Ghost",
  icon: "x",
  section: "control",
  fields: [],
});
