import type { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import type Locator from "../locator/locator.js";
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
  /** The inputs the test declared: the value the run supplies, else the default; reading another name throws */
  inputs: Readonly<Record<string, string>>;
  /** Saves the text values the test declared as outputs */
  outputs: TestOutputs;
}

/** The `outputs` fixture */
export interface TestOutputs {
  /**
   * Waits up to the expect timeout for the element and saves its trimmed text as output `name`. With
   * `pattern`, waits until the text matches and saves the first capture group, else the whole match.
   */
  save(name: string, locator: Locator, pattern?: RegExp): Promise<void>;
}

export type TestCase = TestCaseBase;

/** `skip`: not run. `fixme`: not run, known to be broken. `only`: the only test that runs when any is focused */
export type Modifier = "skip" | "fixme" | "only";

/** The optional second argument of `test.skip`, `test.fixme`, `describe.skip` and `describe.fixme` */
export interface TestDetails {
  /** Why the tests are not run; shown in the report and by `samurai list` */
  reason?: string;
}

/** The optional second argument of `test`, `test.only`, `test.skip` and `test.fixme` */
export interface TestOptions extends TestDetails {
  /** Named text values the test reads, each with the default it gets when nothing supplies one */
  inputs?: Record<string, string>;
  /** Names of the text values the test saves for later tests to use */
  outputs?: string[];
}

/** Runs before or after each test of a suite, in the test's browser, with the test's fixtures */
export type EachHook = (fixtures: TestFixtures) => Promise<void> | void;

/** What `beforeAll` and `afterAll` receive: no page, as they run once for many tests */
export type AllHookFixtures = Pick<
  TestFixtures,
  "env" | "secrets" | "browserName" | "workerIndex"
>;

/** Runs once per worker before the first test of a suite, or after the last one the worker ran */
export type AllHook = (fixtures: AllHookFixtures) => Promise<void> | void;

/** A spec file (the root) or a `describe` block: what a modifier or a hook applies to */
export interface Suite {
  /** The `describe` title; the root of a file has none */
  title?: string;
  parent?: Suite;
  modifier?: Modifier;
  /** The `{ reason }` of a `describe.skip` or `describe.fixme` */
  reason?: string;
  beforeEach?: EachHook[];
  afterEach?: EachHook[];
  beforeAll?: AllHook[];
  afterAll?: AllHook[];
}

export interface RegisteredTestCase extends TestCaseBase {
  /** Path of the spec file that registered the test */
  file: string;
  /** describe titles, then the test title */
  titlePath: string[];
  /** The `describe` block (or the file) the test is written in */
  suite: Suite;
  /** What applies to the test: its own modifier, or the one of a suite around it */
  modifier?: Modifier;
  /** The reason given with the `skip` or `fixme` that applies */
  reason?: string;
  /** The inputs the test declared, with their defaults */
  inputs?: Record<string, string>;
  /** The names of the outputs the test declared */
  outputs?: string[];
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

interface TestResultSuccess extends TestResultIdentity, TestRetries {
  status: "success";
  duration: number;
  logs?: TestLogEntry[];
  /** Entries that fell out of the page's log buffer */
  logsDropped?: number;
  /** Named screenshots the test saved, relative to the result folder */
  screenshots?: { name: string; path: string }[];
  /** The inputs the test declared, with the values this attempt read; absent when it declares none */
  inputs?: Record<string, string>;
  /** The outputs the test saved; absent when it declares none */
  outputs?: Record<string, string>;
}

/** The error sits flat on the entry, as in the report: `message`, `type`, `stack`, and for assertions `expected` and `actual` */
interface TestResultFailed extends TestResultIdentity, TestError, TestRetries {
  status: "failed";
  duration: number;
  logs?: TestLogEntry[];
  logsDropped?: number;
  /** Named screenshots the test saved, relative to the result folder */
  screenshots?: { name: string; path: string }[];
  /** The inputs the test declared, with the values this attempt read; absent when it declares none */
  inputs?: Record<string, string>;
  /** The outputs the test saved; absent when it declares none */
  outputs?: Record<string, string>;
}

/** What a result says about the retries of its test; absent when it passed or failed on the first attempt */
export interface TestRetries {
  /** The attempt this result is from, counting from 1: `retry: 1` is the first run again */
  retry?: number;
  /** The test passed after at least one failed attempt */
  flaky?: true;
  /** The errors of the failed attempts before this one, in order */
  previousAttempts?: TestError[];
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
