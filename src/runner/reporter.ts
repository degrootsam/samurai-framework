import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { maskDeep } from "../config/mask.js";
import type {
  PartialTestResult,
  RegisteredTestCase,
  TestError,
  TestLogEntry,
  TestResult,
  TestSummary,
} from "../types/test.js";

export interface ReporterOptions {
  /** The environment the run uses, recorded in the report */
  environment: string;
  /** Where the report is written. @default <cwd>/result/report.json */
  output?: string;
}

/** Results are keyed by file and full title, so equal titles in different files or describe blocks stay apart */
function keyOf(test: RegisteredTestCase): string {
  return `${test.file}::${test.name}`;
}

export default class TestReporter {
  private testResults: Map<string, TestResult> = new Map();
  private summary: TestSummary | undefined;
  private environment: string;
  private output: string;

  constructor(options: ReporterOptions) {
    this.environment = options.environment;
    this.output = options.output ?? path.join(process.cwd(), "result/report.json");
  }

  public onStart() {
    const t = performance.mark(`group-start`);
    this.summary = {
      duration: 0,
      status: "failed",
      startTime: t.startTime,
      environment: this.environment,
      tests: [],
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
      environment: this.environment,
      tests: Array.from(this.testResults.values()),
      status: Array.from(this.testResults.values()).every(
        (r: TestResult) => r.status === "success",
      )
        ? "success"
        : "failed",
    } as TestSummary;

    await mkdir(path.dirname(this.output), { recursive: true });
    await writeFile(this.output, JSON.stringify(this.summary, null, 2), {
      encoding: "utf8",
    });
  }

  public onTestStart(test: RegisteredTestCase) {
    const key = keyOf(test);
    const t = performance.mark(`${key}-start`);
    this.testResults.set(key, {
      name: test.name,
      file: test.file,
      status: "started",
      startTime: t.startTime,
    });
  }

  public onTestEnd(
    test: RegisteredTestCase,
    error?: TestError,
    logs?: { logs?: TestLogEntry[]; logsDropped?: number },
  ) {
    const key = keyOf(test);
    performance.mark(`${key}-finish`);
    const duration = performance.measure(
      "test-duration",
      `${key}-start`,
      `${key}-finish`,
    ).duration;

    this.testResults.set(
      key,
      maskDeep({
        ...(this.testResults.get(key) as PartialTestResult),
        duration,
        status: error ? "failed" : "success",
        ...(error ? error : undefined),
        ...(logs?.logs && { logs: logs.logs }),
        ...(logs?.logsDropped && { logsDropped: logs.logsDropped }),
      } as TestResult),
    );
  }
}
