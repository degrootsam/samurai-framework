import type {
  PartialTestResult,
  RegisteredTestCase,
  TestCase,
  TestError,
  TestResult,
  TestSummary,
} from "../types/test.js";

export default class TestReporter {
  private testResults: Map<string, TestResult> = new Map();
  private summary: TestSummary | undefined;

  public onStart(test: TestCase) {
    const t = performance.mark(`group-${test.name}-start`);
    this.summary = {
      name: test.name,
      duration: 0,
      status: "failed",
      startTime: t.startTime,
      tests: [],
    };
  }

  public onEnd(test: TestCase) {
    performance.mark(`group-${test.name}-finish`);
    const duration = performance.measure(
      "test-duration",
      `group-${test.name}-start`,
      `group-${test.name}-finish`,
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
    } as TestSummary;

    console.log({ summary: this.summary });
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

  public onTestEnd(test: TestCase, error?: TestError) {
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
    } as TestResult);
  }
}
