import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before } from "node:test";
import type { FlowFile } from "../flows/core/index.js";
import type { SamuraiTestConfig } from "../types/config.js";
import type { runTests } from "../runner/run.js";
import type { FlowEvent, FlowRunResult } from "../flows/run/events.js";
import type { RunFlowInProjectOptions } from "../flows/run/project.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
export let dir: string;

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

export const config: SamuraiTestConfig = {
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

export type N = {
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
export const chain = (nodes: N[], extra?: Partial<FlowFile>) =>
  flowOf(
    [START, ...nodes, END],
    ["start", ...nodes.map((n) => n.id), "end"],
    extra,
  );

/** The summary of one browser's run */
export const inRun = (result: FlowRunResult, browser = "firefox") => {
  const run = result.runs.find((r) => r.browser === browser);
  assert.ok(run, `no ${browser} run`);
  return run.summary;
};

export type Call = Parameters<typeof runTests>[0];
export function harness(over: Partial<RunFlowInProjectOptions> = {}) {
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
