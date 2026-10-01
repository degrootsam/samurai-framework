import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { projectDir } from "../config/config.js";
import { maskDeep } from "../config/mask.js";
import type {
  PartialTestResult,
  RegisteredTestCase,
  TestError,
  TestLogEntry,
  TestResult,
  TestSummary,
} from "../types/test.js";

/** What a run reports while it happens */
export type RunEvent =
  | { type: "run-start"; environment: string; total: number }
  | { type: "test-start"; name: string; file: string }
  | { type: "test-end"; name: string; file: string; result: TestResult }
  | { type: "run-end"; summary: TestSummary };

export interface ReporterOptions {
  /** The environment the run uses, recorded in the report */
  environment: string;
  /** Where the report is written. @default <cwd>/result/report.json */
  output?: string | false;
  /** Called with every event, in order. A throwing listener is ignored */
  onEvent?: (event: RunEvent) => void;
}

/** Results are keyed by file and full title, so equal titles in different files or describe blocks stay apart */
function keyOf(test: RegisteredTestCase): string {
  return `${test.file}::${test.name}`;
}

export default class TestReporter {
  private testResults: Map<string, TestResult> = new Map();
  private summary: TestSummary | undefined;
  private environment: string;
  private output: string | false;
  private listener: ((event: RunEvent) => void) | undefined;

  constructor(options: ReporterOptions) {
    this.environment = options.environment;
    this.output =
      options.output ?? path.join(projectDir(), "result/report.json");
    this.listener = options.onEvent;
  }

  private emit(event: RunEvent): void {
    try {
      this.listener?.(event);
    } catch {
      // A listener must not break the run
    }
  }

  public onStart(total = 0) {
    const t = performance.mark(`group-start`);
    this.summary = {
      duration: 0,
      status: "failed",
      startTime: t.startTime,
      environment: this.environment,
      tests: [],
    };
    this.emit({ type: "run-start", environment: this.environment, total });
  }

  public async onEnd(): Promise<TestSummary> {
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

    if (this.output !== false) {
      await mkdir(path.dirname(this.output), { recursive: true });
      await writeFile(this.output, JSON.stringify(this.summary, null, 2), {
        encoding: "utf8",
      });
    }
    this.emit({ type: "run-end", summary: this.summary });
    return this.summary;
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
    this.emit({ type: "test-start", name: test.name, file: test.file });
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

    const result = maskDeep({
      ...(this.testResults.get(key) as PartialTestResult),
      duration,
      status: error ? "failed" : "success",
      ...(error ? error : undefined),
      ...(logs?.logs && { logs: logs.logs }),
      ...(logs?.logsDropped && { logsDropped: logs.logsDropped }),
    } as TestResult);
    this.testResults.set(key, result);
    this.emit({ type: "test-end", name: test.name, file: test.file, result });
  }
}
