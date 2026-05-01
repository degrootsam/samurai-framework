import type { Browser } from "../browser/browser.ts";
import type Page from "../browser/page.ts";

export type TestCase = TestCaseBase;

export interface RegisteredTestCase extends TestCaseBase {
  file: string;
}

export interface TestCaseBase {
  name: string;
  function: (page: Page, browser: Browser) => Promise<void>;
}

export interface PartialTestResult extends TestResultBase {
  name: string;
  file: string;
}

export type TestResult = TestResultSuccess | TestResultFailed | TestResultBase;

interface TestResultSuccess {
  status: "success";
  duration: number;
}

interface TestResultFailed {
  status: "failed";
  error: TestError;
  duration: number;
}

interface TestResultBase {
  name: string;
  file: string;
  startTime: number;
  status: "started";
}

interface TestError {
  message: string;
  type: "timeout" | "error";
  stack?: string | undefined;
}

export type TestSummary = TestSummarySuccess | TestSummaryFailed;

interface TestSummarySuccess extends TestSummaryBase {
  status: "success";
}

interface TestSummaryFailed extends TestSummaryBase {
  status: "failed";
}

interface TestSummaryBase {
  duration: number;
  startTime: number;
  tests: TestResult[];
}
