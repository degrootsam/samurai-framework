import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { runOutput } from "./output.js";

const project = path.resolve("/p");

describe("runOutput", () => {
  it("writes to the project's result folder by default", () => {
    assert.deepEqual(runOutput({}, project), {
      resultDir: path.join(project, "result"),
      report: path.join(project, "result", "report.json"),
    });
  });

  it("keeps screenshots beside a report path", () => {
    const report = path.resolve("/x/run.json");
    assert.deepEqual(runOutput({ reportPath: report }, project), {
      resultDir: path.dirname(report),
      report,
    });
  });

  it("puts everything in outputDir, relative to the project", () => {
    assert.deepEqual(runOutput({ outputDir: "runs/1" }, project), {
      resultDir: path.join(project, "runs", "1"),
      report: path.join(project, "runs", "1", "report.json"),
    });
  });

  it("an explicit report path or false wins for the report only", () => {
    const out = path.resolve("/o");
    const report = path.resolve("/x/run.json");
    assert.deepEqual(
      runOutput({ outputDir: out, reportPath: false }, project),
      {
        resultDir: out,
        report: false,
      },
    );
    assert.deepEqual(
      runOutput({ outputDir: out, reportPath: report }, project),
      {
        resultDir: out,
        report,
      },
    );
  });
});
