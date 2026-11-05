import type {
  AllHook,
  SuiteMode,
  TestCaseBase,
  TestDetails,
  TestInfo,
  TestOptions,
} from "../types/test.js";
import type { UseOptions } from "../types/use.js";
import type {
  FixtureDefinitions,
  FixturesOf,
  MergeFixtures,
} from "../types/extend.js";

/** What the registry keeps of a test body; the fixtures it gets are those of the test it was written for */
export type Body = TestCaseBase["function"];

/** The fixtures of tests made by `test.extend()`: none for the plain `test` */
export type NoFixtures = Record<never, never>;

/** A test body or hook that gets the built-in fixtures and the custom ones `X` */
export type BodyOf<X> = (fixtures: FixturesOf<X>) => Promise<void>;
export type HookOf<X> = (fixtures: FixturesOf<X>) => Promise<void> | void;

/** `test(title, fn)`, `test.skip(title, fn)`, `test.skip(condition, reason)` and the other forms */
export interface TestFunction<X = NoFixtures> {
  (title: string, fn: BodyOf<X>): void;
  (title: string, options: TestOptions, fn: BodyOf<X>): void;
  /** Registers a test that is not run */
  skip: SkipFunction<X>;
  /** Registers a test that is not run because it is known to be broken */
  fixme: SkipFunction<X>;
  /**
   * Registers a test that is expected to fail (`test.fail("title", fn)`): it is reported as passed when it fails and
   * as failed when it passes. Inside a test or hook, `test.fail()` or `test.fail(condition, reason)` marks the running
   * test the same way; in a `describe` block, `test.fail(true, reason)` marks every test in it.
   */
  fail: FailFunction<X>;
  /**
   * Triples the timeout of the running test (`test.slow()`, `test.slow(condition, reason)`); in a `describe` block
   * `test.slow(true, reason)` does it for every test in it
   */
  slow: ConditionFunction<X>;
  /** Sets the timeout, in milliseconds, of the running test (0: none); the time already spent counts */
  setTimeout: (ms: number) => void;
  /**
   * Runs `body` as a named step of the running test and returns its value; steps nest, and the report lists them
   * with their status, duration and error. A step that throws fails and rethrows.
   */
  step: StepFunction;
  /** Runs only this test (and the other `only` ones) */
  only: {
    (title: string, fn: BodyOf<X>): void;
    (title: string, options: TestOptions, fn: BodyOf<X>): void;
  };
  /** The running test's info, in the test and its hooks; throws outside one */
  info: () => TestInfo;
  /**
   * Sets the `use` options (locale, colorScheme, storageState, ...) for the `describe` block it is written in, or for
   * the whole file at the top level, whether before or after the tests. An inner block wins over an outer one, and
   * both win over config `use`.
   */
  use: (options: UseOptions) => void;
  /** `describe`, under the name other frameworks use */
  describe: DescribeFunction;
  /** `beforeEach`, as `test.beforeEach` */
  beforeEach: (hook: HookOf<X>) => void;
  /** `afterEach`, as `test.afterEach` */
  afterEach: (hook: HookOf<X>) => void;
  /** `beforeAll`, as `test.beforeAll` */
  beforeAll: (hook: AllHook) => void;
  /** `afterAll`, as `test.afterAll` */
  afterAll: (hook: AllHook) => void;
  /**
   * A `test` that also has the fixtures you define: each is a value, or a function `async ({ page }, use) => {
   * ...set up; await use(value); ...clean up }` that may use the built-in fixtures and the other ones. A fixture is
   * set up when a test or hook destructures it, and cleaned up after the test and its `afterEach` hooks. Write
   * `[fixture, { auto: true }]` to set it up for every test. A fixture with the name of a built-in one replaces it.
   */
  extend<T extends object>(
    fixtures: FixtureDefinitions<T, X>,
  ): TestFunction<MergeFixtures<X, T>>;
}

/**
 * With a title and a body it registers a skipped test, `{ reason }` saying why; with a condition it skips the
 * running test when the condition is true
 */
export interface SkipFunction<X> {
  (title: string, fn: BodyOf<X>): void;
  (title: string, options: TestOptions, fn: BodyOf<X>): void;
  /** A function gets the test's fixtures (`({ browserName }) => browserName === "firefox"`) */
  (
    condition: boolean | ((fixtures: FixturesOf<X>) => boolean),
    reason?: string,
  ): void;
}

/** `describe.skip` and `describe.fixme`: every test inside gets the modifier, and `{ reason }` says why */
export interface DescribeSkipFunction {
  (title: string, fn: () => void): void;
  (title: string, details: TestDetails, fn: () => void): void;
}

/** `describe(title, fn)` and the same with a modifier on every test inside */
export interface DescribeFunction {
  (title: string, fn: () => void): void;
  skip: DescribeSkipFunction;
  fixme: DescribeSkipFunction;
  only(title: string, fn: () => void): void;
  /**
   * Sets how the tests of the `describe` block it is written in (of the file, at the top level) run:
   * `"serial"` runs them in order on one worker and skips the rest after a failure, `"parallel"` lets them run on
   * different workers even when the config does not, `"default"` follows the config's `fullyParallel`
   */
  configure(options: { mode: SuiteMode }): void;
  /** A `describe` block in `"serial"` mode */
  serial(title: string, fn: () => void): void;
  /** A `describe` block in `"parallel"` mode */
  parallel(title: string, fn: () => void): void;
}

/** `test.fail()` and `test.slow()`: with a condition (a function gets the test's fixtures), or none for "always" */
export interface ConditionFunction<X> {
  (): void;
  (
    condition: boolean | ((fixtures: FixturesOf<X>) => boolean),
    reason?: string,
  ): void;
}

/** `test.fail("title", fn)` registers a test expected to fail; the other forms mark the running test */
export interface FailFunction<X> extends ConditionFunction<X> {
  (title: string, fn: BodyOf<X>): void;
  (title: string, options: TestOptions, fn: BodyOf<X>): void;
}

/** `test.step(title, body, { timeout })` */
export type StepFunction = <T>(
  title: string,
  body: () => Promise<T> | T,
  options?: { timeout?: number },
) => Promise<T>;
