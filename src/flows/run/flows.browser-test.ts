import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { FlowEvent } from "./events.js";
import { runFlowInProject } from "./project.js";
import { browserConfig, testBrowser } from "../../testing/test-browser.js";

const API = path.resolve("src/api.ts");

const SPEC = `
import { expect, test } from ${JSON.stringify(API)};
test("shows the heading", async ({ page }) => {
  await page.navigateTo("data:text/html,<h1>Hi</h1>");
  await expect(page.getByCss("h1")).toHaveText("Hi");
  await page.screenshot({ name: "heading" });
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
    const outputDir = path.join(dir, "out");
    const result = await runFlowInProject({
      projectDir: dir,
      flowId: "smoke",
      outputDir,
      config: {
        ...browserConfig(),
        srcDir: "./specs",
        environments: { dev: { variables: { region: "eu" } } },
      },
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9261,
      onEvent: (e) => events.push(e),
    });

    assert.equal(result.status, "passed", JSON.stringify(result));
    const browser = testBrowser();
    assert.deepEqual(
      result.runs.map((r) => r.browser),
      [browser],
    );
    const summary = result.runs[0]!.summary;
    assert.deepEqual(summary.vars, { greeting: "hi eu" });
    assert.equal(summary.nodes.heading!.status, "passed");
    assert.equal(summary.nodes.cond!.branch, "true");
    assert.equal(summary.nodes.wait!.status, "passed");
    assert.equal(summary.nodes.never!.status, "skipped");
    assert.ok(
      events.some((e) => e.type === "test" && e.event.type === "test-end"),
    );
    assert.equal(events[events.length - 2]!.type, "flow-end");
    assert.equal(events[events.length - 1]!.type, "flow-done");
    // The screenshot path is relative to outputDir, and starts with the node's folder
    const shots = events.flatMap((e) =>
      e.type === "test" &&
      e.event.type === "test-end" &&
      "screenshots" in e.event.result
        ? (e.event.result.screenshots ?? [])
        : [],
    );
    assert.equal(shots.length, 1);
    assert.ok(
      shots[0]!.path.startsWith(`${browser}/nodes/heading/`),
      shots[0]!.path,
    );
    assert.ok(existsSync(path.join(outputDir, ...shots[0]!.path.split("/"))));
  },
);

test(
  "a Parallel node runs its branches at the same time on the worker pool",
  { timeout: 120000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-flow-par-"));
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      `export default ${JSON.stringify({ srcDir: "./specs", ...browserConfig() })};`,
    );
    mkdirSync(path.join(dir, "specs"));
    mkdirSync(path.join(dir, "flows"));
    const timesLog = path.join(dir, "times.log");
    writeFileSync(timesLog, "");
    process.env.TIMES_LOG = timesLog;
    for (const name of ["left", "right"])
      writeFileSync(
        path.join(dir, `specs/${name}.spec.ts`),
        `
import { appendFileSync } from "node:fs";
import { test } from ${JSON.stringify(API)};
test("${name}", async ({ page }) => {
  appendFileSync(process.env.TIMES_LOG, "start ${name} " + Date.now() + "\\n");
  await page.navigateTo("data:text/html,<h1>Hi</h1>");
  await page.waitForTimeout(2000);
  appendFileSync(process.env.TIMES_LOG, "end ${name} " + Date.now() + "\\n");
});
`,
      );
    writeFileSync(
      path.join(dir, "flows/fan.flow.json"),
      JSON.stringify({
        id: "fan",
        name: "Fan out",
        nodes: [
          node("start", "start"),
          node("par", "parallel"),
          node("left", "test", { ref: { testId: "left.spec.ts::left" } }),
          node("right", "test", { ref: { testId: "right.spec.ts::right" } }),
          node("end", "end"),
        ],
        edges: [
          edge("start", "par"),
          edge("par", "left", "branch-0"),
          edge("par", "right", "branch-1"),
          edge("left", "end"),
          edge("right", "end"),
        ],
      }),
    );

    const summary = await runFlowInProject({
      projectDir: dir,
      flowId: "fan",
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9266,
      workers: 2,
    });

    assert.equal(summary.status, "passed", JSON.stringify(summary));
    const times = new Map(
      readFileSync(timesLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [kind, name, time] = line.split(" ");
          return [`${kind} ${name}`, Number(time)] as const;
        }),
    );
    assert.ok(
      times.get("start left")! < times.get("end right")! &&
        times.get("start right")! < times.get("end left")!,
      "the two branches were running at the same time",
    );
  },
);
