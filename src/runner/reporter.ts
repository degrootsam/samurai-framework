import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type {
  PartialTestResult,
  RegisteredTestCase,
  TestCase,
  TestError,
  TestLogEntry,
  TestResult,
  TestSummary,
} from "../types/test.js";

export default class TestReporter {
  private testResults: Map<string, TestResult> = new Map();
  private summary: TestSummary | undefined;

  public onStart() {
    const t = performance.mark(`group-start`);
    this.summary = {
      duration: 0,
      status: "failed",
      startTime: t.startTime,
      tests: [],
      environment: "default",
    };
  }

  public async onEnd() {
    performance.mark(`group-finish`);
    const duration = performance.measure(
      "test-duration",
      `group-start`,
      `group-finish`,
    ).duration;

    this.summary = {
      ...this.summary,
      duration,
      tests: Array.from(this.testResults.values()),
      status: Array.from(this.testResults.values()).every(
        (r: TestResult) => r.status === "success",
      )
        ? "success"
        : "failed",
      environment: this.summary?.environment ?? "default",
    } as TestSummary;

    const output = path.join(process.cwd(), "result/report.json");
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(this.summary, null, 2), {
      encoding: "utf8",
    });
  }

  public onTestStart(test: RegisteredTestCase) {
    const t = performance.mark(`${test.name}-start`);
    this.testResults.set(test.name, {
      name: test.name,
      file: test.file,
      status: "started",
      startTime: t.startTime,
    });
  }

  public onTestEnd(
    test: TestCase,
    error?: TestError,
    logs?: { logs?: TestLogEntry[]; logsDropped?: number },
  ) {
    performance.mark(`${test.name}-finish`);
    const duration = performance.measure(
      "test-duration",
      `${test.name}-start`,
      `${test.name}-finish`,
    ).duration;

    this.testResults.set(test.name, {
      ...(this.testResults.get(test.name) as PartialTestResult),
      duration,
      status: error ? "failed" : "success",
      ...(error ? error : undefined),
      ...(logs?.logs && { logs: logs.logs }),
      ...(logs?.logsDropped && { logsDropped: logs.logsDropped }),
    } as TestResult);
  }
}
