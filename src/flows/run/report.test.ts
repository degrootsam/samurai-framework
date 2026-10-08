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
    b.handle({ type: "flow-start", environment: "staging" });
    b.handle({
      type: "test",
      nodeId: "t",
      event: { type: "test-start", name: "x", file: "f" },
    });
    b.handle({
      type: "test",
      nodeId: "t",
      event: {
        type: "test-end",
        name: failed.name!,
        file: "f",
        result: failed,
      },
    });
    const report = b.finish({
      status: "failed",
      nodes: { t: { status: "failed" } },
      vars: { a: 1 },
    });
    assert.equal(report.flow, "checkout");
    assert.equal(report.environment, "staging");
    assert.equal(report.status, "failed");
    assert.deepEqual(report.vars, { a: 1 });
    assert.equal(report.tests.length, 1);
    assert.equal(report.tests[0]!.nodeId, "t");
    assert.equal(
      (report.tests[0] as { message?: string }).message,
      failed && (failed as { message?: string }).message,
    );
    assert.ok(!Number.isNaN(Date.parse(report.startedAt)));
  });

  it("writes result/flows/<id>.json with secrets masked", async () => {
    registerSecret("TOKEN", "s3cret-token");
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-flow-report-"));
    dirs.push(dir);
    const b = new FlowReportBuilder({ id: "checkout", name: "Checkout" });
    b.handle({ type: "flow-start", environment: "dev" });
    b.handle({
      type: "test",
      nodeId: "t",
      event: { type: "test-end", name: "n", file: "f", result: failed },
    });
    const file = await writeFlowReport(
      dir,
      b.finish({
        status: "failed",
        nodes: { t: { status: "failed", error: "bad s3cret-token" } },
        vars: { k: "s3cret-token" },
      }),
    );
    assert.equal(file, path.join(dir, "result/flows/checkout.json"));
    const text = readFileSync(file, "utf8");
    assert.ok(!text.includes("s3cret-token"));
    assert.equal(JSON.parse(text).status, "failed");
  });
});
