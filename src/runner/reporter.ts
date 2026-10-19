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
import type { SupportedBrowser } from "../types/browser.js";

/** What a run reports while it happens */
export type RunEvent =
  | {
      type: "run-start";
      environment: string;
      /** Every selected test in every browser */
      total: number;
      browsers: SupportedBrowser[];
      /** How many tests run at the same time; absent when they run one after the other */
      workers?: number;
    }
  | {
      type: "test-start";
      name: string;
      file: string;
      browser: SupportedBrowser;
    }
  | {
      type: "test-end";
      name: string;
      file: string;
      browser: SupportedBrowser;
      result: TestResult;
    }
  | { type: "run-end"; summary: TestSummary };

export interface ReporterOptions {
  /** The environment the run uses, recorded in the report */
  environment: string;
  /** The browsers the run uses, in the order they run; recorded in the report */
  browsers: SupportedBrowser[];
  /** Where the report is written. @default <cwd>/result/report.json */
  output?: string | false;
  /** Called with every event, in order. A throwing listener is ignored */
  onEvent?: (event: RunEvent) => void;
}

/** Results are keyed by file, full title and browser, so equal titles in different files or describe blocks, and the same test in two browsers, stay apart */
function keyOf(test: RegisteredTestCase, browser: SupportedBrowser): string {
  return `${test.file}::${test.name}::${browser}`;
}

/** What `runOneTest` reports a test to: the reporter of a run, or a worker that relays it */
export interface TestSink {
  onTestStart(test: RegisteredTestCase, browser: SupportedBrowser): void;
  onTestEnd(
    test: RegisteredTestCase,
    browser: SupportedBrowser,
    error?: TestError,
    extras?: TestEndExtras,
  ): void;
  /** A test that does not run: reported as started and ended at once */
  onTestSkipped(
    test: RegisteredTestCase,
    browser: SupportedBrowser,
    skip: TestSkip,
  ): void;
}

/** Why a test was skipped */
export interface TestSkip {
  annotation: "skip" | "fixme";
  reason?: string | undefined;
}

/** What a test's report entry lists besides its status */
export interface TestEndExtras {
  logs?: TestLogEntry[];
  logsDropped?: number;
  screenshots?: { name: string; path: string }[];
}

export default class TestReporter implements TestSink {
  private testResults: Map<string, TestResult> = new Map();
  private summary: TestSummary | undefined;
  private environment: string;
  private browsers: SupportedBrowser[];
  private output: string | false;
  private listener: ((event: RunEvent) => void) | undefined;
  /** Keys of the run's tests in the order the report lists them; unset: the order they started in */
  private order: string[] | undefined;

  constructor(options: ReporterOptions) {
    this.environment = options.environment;
    this.browsers = [...options.browsers];
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

  /** Lists the tests of the run in the order the report shows them, whichever order they end in */
  public setOrder(
    tests: { test: RegisteredTestCase; browser: SupportedBrowser }[],
  ) {
    this.order = tests.map(({ test, browser }) => keyOf(test, browser));
  }

  public onStart(total: number, workers = 1) {
    const t = performance.mark("run-start");
    this.summary = {
      duration: 0,
      status: "failed",
      startTime: t.startTime,
      environment: this.environment,
      browsers: this.browsers,
      tests: [],
    };
    this.emit({
      type: "run-start",
      environment: this.environment,
      total,
      browsers: this.browsers,
      ...(workers > 1 && { workers }),
    });
  }

  public async onEnd(): Promise<TestSummary> {
    performance.mark("run-end");
    const duration = performance.measure(
      "test-duration",
      "run-start",
      "run-end",
    ).duration;
    const tests = this.order
      ? [
          ...this.order.flatMap((key) => this.testResults.get(key) ?? []),
          ...[...this.testResults]
            .filter(([key]) => !this.order!.includes(key))
            .map(([, result]) => result),
        ]
      : [...this.testResults.values()];

    this.summary = {
      ...this.summary,
      duration,
      environment: this.environment,
      browsers: this.browsers,
      tests,
      status: tests.every(
        (r: TestResult) => r.status === "success" || r.status === "skipped",
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

  public onTestStart(test: RegisteredTestCase, browser: SupportedBrowser) {
    const key = keyOf(test, browser);
    const t = performance.mark(`${key}-start`);
    this.testResults.set(key, {
      name: test.name,
      file: test.file,
      browser,
      status: "started",
      startTime: t.startTime,
    });
    this.emit({
      type: "test-start",
      name: test.name,
      file: test.file,
      browser,
    });
  }

  public onTestSkipped(
    test: RegisteredTestCase,
    browser: SupportedBrowser,
    { annotation, reason }: TestSkip,
  ) {
    const key = keyOf(test, browser);
    // A test skipped from inside already started; one that never ran starts and ends at once
    if (this.testResults.get(key)?.status !== "started")
      this.onTestStart(test, browser);
    const result = maskDeep({
      ...(this.testResults.get(key) as PartialTestResult),
      status: "skipped",
      duration: 0,
      annotation,
      ...(reason !== undefined && { reason }),
    } as TestResult);
    this.testResults.set(key, result);
    this.emit({
      type: "test-end",
      name: test.name,
      file: test.file,
      browser,
      result,
    });
  }

  /**
   * Ends a test that ran in a worker: the worker built the result (masked, with its own duration), this keeps the
   * start time from this process's clock, as the worker's clock has another origin
   */
  public onRemoteEnd(
    test: RegisteredTestCase,
    browser: SupportedBrowser,
    result: TestResult,
  ) {
    const key = keyOf(test, browser);
    const started = this.testResults.get(key);
    const ended = {
      ...result,
      ...(started && { startTime: started.startTime }),
    } as TestResult;
    this.testResults.set(key, ended);
    this.emit({
      type: "test-end",
      name: test.name,
      file: test.file,
      browser,
      result: ended,
    });
  }

  public onTestEnd(
    test: RegisteredTestCase,
    browser: SupportedBrowser,
    error?: TestError,
    extras?: TestEndExtras,
  ) {
    const key = keyOf(test, browser);
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
      ...(extras?.logs && { logs: extras.logs }),
      ...(extras?.logsDropped && { logsDropped: extras.logsDropped }),
      ...(extras?.screenshots?.length && { screenshots: extras.screenshots }),
    } as TestResult);
    this.testResults.set(key, result);
    this.emit({
      type: "test-end",
      name: test.name,
      file: test.file,
      browser,
      result,
    });
  }
}
