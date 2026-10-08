import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { FlowEvent } from "./events.js";
import { runFlowInProject } from "./project.js";

const API = path.resolve("src/api.ts");

const SPEC = `
import { expect, test } from ${JSON.stringify(API)};
test("shows the heading", async ({ page }) => {
  await page.navigateTo("data:text/html,<h1>Hi</h1>");
  await expect(page.getByCss("h1")).toHaveText("Hi");
});
`;

const node = (id: string, kind: string, extra: object = {}) => ({
  id,
  key: id,
  kind,
  onFailure: "stop",
  position: { x: 0, y: 0 },
  ...extra,
});
const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});

test(
  "a project flow runs end to end: Test, Set variable, Condition, Wait",
  { timeout: 120000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-flow-"));
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    mkdirSync(path.join(dir, "specs"));
    mkdirSync(path.join(dir, "flows"));
    writeFileSync(path.join(dir, "specs/shop.spec.ts"), SPEC);
    writeFileSync(
      path.join(dir, "flows/smoke.flow.json"),
      JSON.stringify({
        id: "smoke",
        name: "Smoke",
        nodes: [
          node("start", "start"),
          node("heading", "test", {
            ref: { testId: "shop.spec.ts::shows the heading" },
          }),
          node("set", "set-variable", {
            config: { name: "greeting", value: '"hi " + env.region' },
          }),
          node("cond", "condition", {
            config: { expr: 'nodes.heading.status == "passed"' },
          }),
          node("wait", "wait", { config: { ms: 10 } }),
          node("never", "wait", { config: { ms: 10 } }),
          node("end", "end"),
        ],
        edges: [
          edge("start", "heading"),
          edge("heading", "set"),
          edge("set", "cond"),
          edge("cond", "wait", "true"),
          edge("cond", "never", "false"),
          edge("wait", "end"),
          edge("never", "end"),
        ],
      }),
    );

    const events: FlowEvent[] = [];
    const summary = await runFlowInProject({
      projectDir: dir,
      flowId: "smoke",
      config: {
        srcDir: "./specs",
        environments: { dev: { variables: { region: "eu" } } },
      },
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9261,
      onEvent: (e) => events.push(e),
    });

    assert.equal(summary.status, "passed", JSON.stringify(summary));
    assert.deepEqual(summary.vars, { greeting: "hi eu" });
    assert.equal(summary.nodes.heading!.status, "passed");
    assert.equal(summary.nodes.cond!.branch, "true");
    assert.equal(summary.nodes.wait!.status, "passed");
    assert.equal(summary.nodes.never!.status, "skipped");
    assert.ok(
      events.some((e) => e.type === "test" && e.event.type === "test-end"),
    );
    assert.equal(events[events.length - 1]!.type, "flow-end");
  },
);
