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
  logs?: TestLogEntry[];
  /** Entries that fell out of the page's log buffer */
  logsDropped?: number;
}

interface TestResultFailed {
  status: "failed";
  error: TestError;
  duration: number;
  logs?: TestLogEntry[];
  logsDropped?: number;
}

/** One line of the browser's log, as stored in the report */
export interface TestLogEntry {
  level: "debug" | "info" | "warn" | "error";
  /** "console", "javascript" (an uncaught exception), or another type the browser reports */
  type: string;
  method?: string;
  text: string;
  timestamp: number;
}

interface TestResultBase {
  name: string;
  file: string;
  startTime: number;
  status: "started";
}

interface TestError {
  message: string;
  type: "timeout" | "error" | "assertion";
  stack?: string | undefined;
  /** Only for `type: "assertion"` */
  expected?: unknown;
  /** Only for `type: "assertion"` */
  actual?: unknown;
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
