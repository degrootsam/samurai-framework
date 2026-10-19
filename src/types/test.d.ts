import type { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import type { SupportedBrowser } from "./browser.js";

/** What a test function receives */
export interface TestFixtures {
  page: Page;
  browser: Browser;
  /** The browser this run of the test is in */
  browserName: SupportedBrowser;
  /** The worker process running the test; 0 when the run has one worker or none */
  workerIndex: number;
  /** The chosen environment's variables; reading an unknown name throws */
  env: Readonly<Record<string, string | number | boolean>>;
  /** Secrets by name (SAMURAI_SECRET_<NAME>); reading an unset name throws */
  secrets: Readonly<Record<string, string>>;
}

export type TestCase = TestCaseBase;

export interface RegisteredTestCase extends TestCaseBase {
  /** Path of the spec file that registered the test */
  file: string;
  /** describe titles, then the test title */
  titlePath: string[];
}

export interface TestCaseBase {
  /** Full title: describe titles and the test title joined with " > " */
  name: string;
  function: (fixtures: TestFixtures) => Promise<void>;
}

export interface PartialTestResult extends TestResultBase {
  name: string;
  file: string;
}

export type TestResult =
  TestResultSuccess | TestResultFailed | TestResultSkipped | TestResultBase;

interface TestResultSuccess extends TestResultIdentity {
  status: "success";
  duration: number;
  logs?: TestLogEntry[];
  /** Entries that fell out of the page's log buffer */
  logsDropped?: number;
  /** Named screenshots the test saved, relative to the result folder */
  screenshots?: { name: string; path: string }[];
}

/** The error sits flat on the entry, as in the report: `message`, `type`, `stack`, and for assertions `expected` and `actual` */
interface TestResultFailed extends TestResultIdentity, TestError {
  status: "failed";
  duration: number;
  logs?: TestLogEntry[];
  logsDropped?: number;
  /** Named screenshots the test saved, relative to the result folder */
  screenshots?: { name: string; path: string }[];
}

/** A test that was not run: marked `skip` or `fixme`, or skipped from inside with `test.skip(condition)` */
interface TestResultSkipped extends TestResultIdentity {
  status: "skipped";
  duration: 0;
  /** `"fixme"` for a test known to be broken, `"skip"` for the rest */
  annotation: "skip" | "fixme";
  reason?: string;
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

interface TestResultIdentity {
  name: string;
  file: string;
  /** The browser the test ran in */
  browser: SupportedBrowser;
  /** The worker process that ran the test; absent when the test ran in the main process */
  worker?: number;
  startTime: number;
}

interface TestResultBase {
  name: string;
  file: string;
  browser: SupportedBrowser;
  worker?: number;
  startTime: number;
  status: "started";
}

export interface TestError {
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
  /** No test failed (skipped tests do not count as failed) */
  status: "success";
}

interface TestSummaryFailed extends TestSummaryBase {
  status: "failed";
}

interface TestSummaryBase {
  duration: number;
  startTime: number;
  tests: TestResult[];
  /** The environment the run used */
  environment: string;
  /** The browsers the run used, in the order they ran */
  browsers: SupportedBrowser[];
}
