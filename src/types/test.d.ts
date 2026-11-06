import type { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import type { BrowserContext } from "../browser/browser-context.js";
import type Locator from "../locator/locator.js";
import type { APIRequestContext } from "../request/api-request-context.js";
import type { SupportedBrowser } from "./browser.js";
import type { UseOptions } from "./use.js";

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
  /** The browser context (cookies, storage) of `page`; same as `page.context()` */
  context: BrowserContext;
  /** The run's `baseURL` (the environment's, else the project's); `undefined` when none is set */
  baseURL: string | undefined;
  /**
   * Makes HTTP requests without a browser: its own cookies, the run's `baseURL`, `use.extraHTTPHeaders` and
   * `use.acceptInsecureCerts`. For requests that share the page's cookies use `page.request`.
   */
  request: APIRequestContext;
  /** About the running test: its title, retry, attachments; same as `test.info()` */
  testInfo: TestInfo;
  /** Whether the page runs as a phone (`use.isMobile`); always false on Firefox, which cannot do it */
  isMobile: boolean;
  /** Whether the page has touch input (`use.hasTouch`); always false on Firefox, which cannot do it */
  hasTouch: boolean;
}

/** A file or text a test attached to its result */
export interface TestAttachment {
  name: string;
  contentType: string;
  /** Absolute path of the saved file */
  path: string;
}

/** An attachment as the report lists it */
export interface TestAttachmentEntry {
  name: string;
  contentType: string;
  /** Relative to the result folder */
  path: string;
}

/** A note on a test (`{ type: "issue", description: "PROJ-1" }`) that the report lists */
export interface TestAnnotation {
  type: string;
  description?: string;
}

/** A step the test ran with `test.step`, as the report lists it */
export interface TestStepEntry {
  title: string;
  /** `"skipped"`: the step ended the test with `test.skip(...)` */
  status: "passed" | "failed" | "skipped";
  /** Milliseconds */
  duration: number;
  /** The message of what the step threw, or that the test ended before it finished */
  error?: string;
  /** The steps started inside this one; absent when there are none */
  steps?: TestStepEntry[];
}

/** How a fixture's setup or teardown went in one test */
export interface TestFixturePhase {
  /** `"skipped"`: a worker fixture another test of this worker already set up */
  status: "passed" | "failed" | "skipped";
  /** Milliseconds */
  durationMs: number;
  error?: TestError;
}

/** A fixture that set up for a test (hand-written `test.extend` ones too), as the report lists it */
export interface TestFixtureEntry {
  name: string;
  scope: "test" | "worker";
  setup: TestFixturePhase;
  /** Absent for a worker fixture: it is torn down when the worker is done, after the test's result is written */
  teardown?: Omit<TestFixturePhase, "status"> & { status: "passed" | "failed" };
  /** The declared outputs that are not secret */
  outputs?: Record<string, string | number | boolean>;
}

/** What `testInfo` and `test.info()` tell about the running test (hooks included) */
export interface TestInfo {
  /** The test's own title */
  readonly title: string;
  /** The `describe` titles, then the title */
  readonly titlePath: string[];
  /** Absolute path of the spec file */
  readonly file: string;
  /** Where the test is written; absent when unknown */
  readonly line?: number;
  readonly column?: number;
  /** The attempt, counting from 0: 1 is the first run again */
  readonly retry: number;
  readonly workerIndex: number;
  /** The browser this run is in. There is no `projects` matrix yet, so `name` is the browser name */
  readonly project: { name: string };
  /** The run settings that apply to the test */
  readonly config: { baseURL: string | undefined; timeout: number };
  /** Push notes here; they are listed in the report entry */
  annotations: TestAnnotation[];
  /** Undefined while the test body runs; set before the `afterEach` hooks */
  readonly status: "passed" | "failed" | "skipped" | undefined;
  /** What the test is expected to end as: `"failed"` after `test.fail()`, else `"passed"` */
  readonly expectedStatus: "passed" | "failed";
  /** The time limit of the test in milliseconds (0: none); see `setTimeout` */
  readonly timeout: number;
  /** Sets the limit of this test, counted from its start; `0` removes it */
  setTimeout(ms: number): void;
  /** Triples the timeout, once, and adds a `slow` annotation; nothing happens when `condition` is false */
  slow(condition?: boolean, description?: string): void;
  /** Expects the test to fail (`expectedStatus` is `"failed"`) and adds a `fail` annotation */
  fail(condition?: boolean, description?: string): void;
  /** Ends the test as skipped when `condition` is not false */
  skip(condition?: boolean, description?: string): void;
  /** Ends the test as skipped (known to be broken) when `condition` is not false */
  fixme(condition?: boolean, description?: string): void;
  /** Milliseconds since the attempt started; fixed once the body is done */
  readonly duration: number;
  /** The errors of the test body or of its `beforeEach` hooks; filled before the `afterEach` hooks */
  readonly errors: TestError[];
  /** Folder for the files this attempt attaches (created when the first one is saved) */
  readonly outputDir: string;
  readonly attachments: readonly TestAttachment[];
  /** Saves a file in `outputDir` and lists it in the report entry; give `body` or `path`, not both */
  attach(
    name: string,
    options: { body?: string | Buffer; path?: string; contentType?: string },
  ): Promise<void>;
}

/** The `outputs` fixture */
export interface TestOutputs {
  /**
   * Waits up to the expect timeout for the element to have text and saves its trimmed text as output `name`.
   * With `pattern`, waits until the text matches and saves the first capture group, else the whole match.
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
  /** Notes on the test, such as `{ type: "plan", description: "plans/pay.plan.md" }`; the report lists them first */
  annotations?: TestAnnotation[];
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
  /** `test.fail(true)` and `test.slow(true)` written in this scope: they apply to every test below */
  marks?: { type: "fail" | "slow"; description?: string }[];
  /** The `test.use()` calls written in this scope, in order; they apply to every test below */
  use?: UseOptions[];
  /** Set by `describe.configure({ mode })`, `describe.serial` or `describe.parallel`; absent: `"default"` */
  mode?: SuiteMode;
}

/** How the tests of a suite run: `"serial"` in order on one worker, the rest stops at the first failure */
export type SuiteMode = "default" | "parallel" | "serial";

export interface RegisteredTestCase extends TestCaseBase {
  /** Path of the spec file that registered the test */
  file: string;
  /** describe titles, then the test title */
  titlePath: string[];
  /** Where the test is written, when known */
  line?: number;
  column?: number;
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
  /** The annotations the test declared; every run of the test starts with them */
  annotations?: TestAnnotation[];
  /** Registered with `test.fail("title", fn)`: expected to fail; `description` is the `{ reason }` given */
  expectedFail?: { description?: string };
  /** The custom fixtures of the `test` it was written with (`test.extend()`); absent for the plain `test` */
  extension?: ReadonlyMap<string, readonly unknown[]>;
  /** The group this run of the test is for, when groups were selected; the same test runs once per selected group */
  group?: string;
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
  /** Files the test attached, relative to the result folder; absent when it attached none */
  attachments?: TestAttachmentEntry[];
  /** The notes the test pushed to `testInfo.annotations`; absent when there are none */
  annotations?: TestAnnotation[];
  /** The steps the test ran with `test.step`; absent when it ran none */
  steps?: TestStepEntry[];
  /** The fixtures the test set up and how each went; absent when it used none */
  fixtures?: TestFixtureEntry[];
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
  /** Files the test attached, relative to the result folder; absent when it attached none */
  attachments?: TestAttachmentEntry[];
  /** The notes the test pushed to `testInfo.annotations`; absent when there are none */
  annotations?: TestAnnotation[];
  /** The steps the test ran with `test.step`; absent when it ran none */
  steps?: TestStepEntry[];
  /** The fixtures the test set up and how each went; absent when it used none */
  fixtures?: TestFixtureEntry[];
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
  /** The group the test ran for, when the run selected groups (`--group`); absent otherwise */
  group?: string;
  /** The worker process that ran the test; absent when the test ran in the main process */
  worker?: number;
  startTime: number;
}

interface TestResultBase {
  name: string;
  file: string;
  browser: SupportedBrowser;
  group?: string;
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
  /** The slice of the selected tests the run held (`--shard`); absent for a whole run */
  shard?: { current: number; total: number };
}
