import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { FlowFile } from "../core/index.js";
import type { runTests } from "../../runner/run.js";
import type { RunHooks } from "../../runner/worker-pool.js";
import type { WorkItem } from "../../runner/worker-protocol.js";
import type { SamuraiTestConfig } from "../../types/config.js";
import type { TestResult } from "../../types/test.js";
import { checkFlowInProject, runFlowInProject } from "./project.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
let dir: string;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "samurai-flow-io-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(
    path.join(dir, "src/shop.spec.ts"),
    `import { test } from ${API};
test("buy", { outputs: ["orderId"] }, async () => {});
test("check", { inputs: { orderId: "none" } }, async () => {});
`,
  );
});
after(() => rmSync(dir, { recursive: true, force: true }));

const config: SamuraiTestConfig = { browsers: ["firefox", "chrome"] };

const flowOf = (ids: string[]): FlowFile => ({
  id: "f",
  name: "f",
  nodes: [
    { id: "start", kind: "start" },
    {
      id: "buy",
      kind: "test",
      title: "Buy",
      ref: { testId: "shop.spec.ts::buy" },
    },
    { id: "check", kind: "test", ref: { testId: "shop.spec.ts::check" } },
    { id: "end", kind: "end" },
  ]
    .filter((n) => ids.includes(n.id))
    .map((n) => ({
      ...n,
      onFailure: "continue" as const,
      position: { x: 0, y: 0 },
      key: n.id,
    })),
  edges: ids
    .slice(1)
    .map((id, i) => ({ id: `e${i}`, source: ids[i]!, target: id })),
});

const resultOf = (
  name: string,
  file: string,
  browser: TestResult["browser"],
  outputs?: Record<string, string>,
): TestResult =>
  ({
    name,
    file,
    browser,
    startTime: 0,
    duration: 1,
    status: "success",
    ...(outputs && { outputs }),
  }) as TestResult;

type Call = NonNullable<Parameters<typeof runTests>[0]>;

describe("runFlowInProject wires outputs to inputs", () => {
  it("checkFlowInProject reports an input with no source", async () => {
    const { problems } = await checkFlowInProject({
      projectDir: dir,
      config,
      flow: flowOf(["start", "check", "end"]),
    });
    assert.deepEqual(
      problems.map((p) => [p.level, p.message]),
      [
        [
          "error",
          'check: input "orderId" has no source. Save it as an output in an earlier test, set an expression, or use the default',
        ],
      ],
    );
  });

  it("a wired flow passes the check", async () => {
    const { problems } = await checkFlowInProject({
      projectDir: dir,
      config,
      flow: flowOf(["start", "buy", "check", "end"]),
    });
    assert.deepEqual(problems, []);
  });

  it("each browser's run has its own values: Firefox's never reach Chrome's consumer", async () => {
    const calls: Call[] = [];
    const result = await runFlowInProject({
      projectDir: dir,
      config,
      flow: flowOf(["start", "buy", "check", "end"]),
      testRunner: (async (o: Call) => {
        calls.push(o);
        const browser = o.browsers![0]!;
        const name = o.testNames![0]!;
        // Only Firefox's buy saves an orderId
        const saved =
          name === "buy" && browser === "firefox"
            ? { orderId: "F-1" }
            : undefined;
        o.onEvent?.({
          type: "test-end",
          name,
          file: o.files![0]!,
          browser,
          result: resultOf(name, o.files![0]!, browser, saved),
        });
        return { status: "success" } as Awaited<ReturnType<typeof runTests>>;
      }) as typeof runTests,
    });
    assert.deepEqual(
      calls.map((c) => [c.browsers![0], c.testNames![0], c.inputs]),
      [
        ["firefox", "buy", undefined],
        ["firefox", "check", { orderId: "F-1" }],
        ["chrome", "buy", undefined],
      ],
    );
    const chrome = result.runs.find((r) => r.browser === "chrome")!.summary;
    assert.equal(chrome.nodes.check!.status, "failed");
    assert.equal(
      chrome.nodes.check!.error,
      'input "orderId": Buy saved no orderId',
    );
    const firefox = result.runs.find((r) => r.browser === "firefox")!.summary;
    assert.deepEqual(firefox.nodes.check!.inputs, { orderId: "F-1" });
  });

  it("on the worker pool, each item carries the node's inputs", async () => {
    const runs: WorkItem[][] = [];
    const result = await runFlowInProject({
      projectDir: dir,
      config,
      browsers: ["firefox"],
      workers: 2,
      createPool: () => ({
        async run(items: WorkItem[], hooks: RunHooks = {}) {
          runs.push(items);
          return items.map((item) => {
            const result = resultOf(
              item.testName,
              item.file,
              item.browser,
              item.testName === "buy" ? { orderId: "P-9" } : undefined,
            );
            hooks.onEvent?.({ type: "test-end", item, worker: 0, result });
            return result;
          });
        },
        async dispose() {},
      }),
      flow: flowOf(["start", "buy", "check", "end"]),
    });
    assert.equal(result.status, "passed");
    assert.deepEqual(
      runs.map((items) => items.map((i) => [i.testName, i.inputs])),
      [[["buy", undefined]], [["check", { orderId: "P-9" }]]],
    );
  });
});
