import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { registerSecret, resetSecrets } from "../../config/mask.js";
import type { TestResult } from "../../types/test.js";
import { FlowReportBuilder, writeFlowReport } from "./report.js";

const dirs: string[] = [];
after(() => {
  resetSecrets();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const failed = {
  name: "Cart > adds",
  file: "/p/src/cart.spec.ts",
  status: "failed",
  startTime: 0,
  duration: 12,
  type: "error",
  message: "token s3cret-token rejected",
} as unknown as TestResult;

describe("flow report", () => {
  it("collects the tests that ended, by node, and builds the report", () => {
    const b = new FlowReportBuilder({ id: "checkout", name: "Checkout" });
    b.handle({
      type: "flow-start",
      environment: "staging",
      browser: "firefox",
    });
    b.handle({
      type: "test",
      browser: "firefox",
      nodeId: "t",
      event: { type: "test-start", name: "x", file: "f", browser: "firefox" },
    });
    b.handle({
      type: "test",
      browser: "firefox",
      nodeId: "t",
      event: {
        type: "test-end",
        name: failed.name!,
        file: "f",
        browser: "firefox",
        result: failed,
      },
    });
    const firefox = {
      status: "failed" as const,
      nodes: { t: { status: "failed" as const } },
      vars: { a: 1 },
    };
    const chrome = { status: "passed" as const, nodes: {}, vars: {} };
    const report = b.finish({
      status: "failed",
      runs: [
        { browser: "firefox", summary: firefox },
        { browser: "chrome", summary: chrome },
      ],
    });
    assert.equal(report.flow, "checkout");
    assert.equal(report.environment, "staging");
    assert.equal(report.status, "failed");
    assert.equal(report.runs.length, 2);
    assert.deepEqual(report.runs[0], { browser: "firefox", summary: firefox });
    assert.deepEqual(report.runs[1], { browser: "chrome", summary: chrome });
    assert.equal(report.tests.length, 1);
    assert.equal(report.tests[0]!.nodeId, "t");
    assert.equal(
      (report.tests[0] as { message?: string }).message,
      failed && (failed as { message?: string }).message,
    );
    assert.ok(!Number.isNaN(Date.parse(report.startedAt)));
  });

  it("keeps a skipped test in the report with its reason", () => {
    const b = new FlowReportBuilder({ id: "checkout", name: "Checkout" });
    b.handle({
      type: "test",
      browser: "firefox",
      nodeId: "t",
      event: {
        type: "test-end",
        name: "old flow",
        file: "f",
        browser: "firefox",
        result: {
          name: "old flow",
          file: "f",
          browser: "firefox",
          startTime: 0,
          status: "skipped",
          duration: 0,
          annotation: "fixme",
          reason: "broken on staging",
        },
      },
    });
    const report = b.finish({
      status: "passed",
      runs: [
        {
          browser: "firefox",
          summary: { status: "passed", nodes: {}, vars: {} },
        },
      ],
    });
    assert.deepEqual(
      report.tests.map((t) => [t.nodeId, t.status]),
      [["t", "skipped"]],
    );
    assert.equal(
      (report.tests[0] as { reason?: string }).reason,
      "broken on staging",
    );
  });

  it("writes result/flows/<id>.json with secrets masked", async () => {
    registerSecret("TOKEN", "s3cret-token");
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-flow-report-"));
    dirs.push(dir);
    const b = new FlowReportBuilder({ id: "checkout", name: "Checkout" });
    b.handle({ type: "flow-start", environment: "dev", browser: "firefox" });
    b.handle({
      type: "test",
      browser: "firefox",
      nodeId: "t",
      event: {
        type: "test-end",
        name: "n",
        file: "f",
        browser: "firefox",
        result: failed,
      },
    });
    const file = await writeFlowReport(
      dir,
      b.finish({
        status: "failed",
        runs: [
          {
            browser: "firefox",
            summary: {
              status: "failed",
              nodes: { t: { status: "failed", error: "bad s3cret-token" } },
              vars: { k: "s3cret-token" },
            },
          },
        ],
      }),
    );
    assert.equal(file, path.join(dir, "result/flows/checkout.json"));
    const text = readFileSync(file, "utf8");
    assert.ok(!text.includes("s3cret-token"));
    assert.equal(JSON.parse(text).status, "failed");
  });
});
