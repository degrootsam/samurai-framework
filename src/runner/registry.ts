import { fileURLToPath } from "node:url";
import logger from "../logger/index.js";
import type {
  AllHook,
  EachHook,
  Modifier,
  RegisteredTestCase,
  TestCaseBase,
  TestDetails,
  TestOptions,
} from "../types/test.js";
import { SkipSignal } from "./skip.js";
import { validateTestIO } from "./test-io.js";
import {
  addHook,
  currentSuite,
  enterSuite,
  leaveSuite,
  modifierOf,
  resetSuites,
} from "./suite.js";

type Body = TestCaseBase["function"];

const registered: RegisteredTestCase[] = [];

/** `test(title, fn)`, `test.skip(title, fn)`, `test.skip(condition, reason)` and the other forms */
export interface TestFunction {
  (title: string, fn: Body): void;
  (title: string, options: TestOptions, fn: Body): void;
  /** Registers a test that is not run */
  skip: SkipFunction;
  /** Registers a test that is not run because it is known to be broken */
  fixme: SkipFunction;
  /** Runs only this test (and the other `only` ones) */
  only: {
    (title: string, fn: Body): void;
    (title: string, options: TestOptions, fn: Body): void;
  };
}

/**
 * With a title and a body it registers a skipped test, `{ reason }` saying why; with a condition it skips the
 * running test when the condition is true
 */
interface SkipFunction {
  (title: string, fn: Body): void;
  (title: string, options: TestOptions, fn: Body): void;
  (condition: boolean, reason?: string): void;
}

/** `describe.skip` and `describe.fixme`: every test inside gets the modifier, and `{ reason }` says why */
interface DescribeSkipFunction {
  (title: string, fn: () => void): void;
  (title: string, details: TestDetails, fn: () => void): void;
}

/** `describe(title, fn)` and the same with a modifier on every test inside */
export interface DescribeFunction {
  (title: string, fn: () => void): void;
  skip: DescribeSkipFunction;
  fixme: DescribeSkipFunction;
  only(title: string, fn: () => void): void;
}

/** Runs `fn` as the `describe` block `title`, under `modifier` when there is one. `fn` runs immediately and must be synchronous. */
function openDescribe(
  file: string,
  title: string,
  fn: () => void,
  modifier?: Modifier,
  reason?: string,
): void {
  enterSuite(file, title, modifier, reason);
  try {
    const result: unknown = fn();
    if (result instanceof Promise) {
      result.catch(() => {});
      throw new Error(
        "describe() callback must be synchronous; it only registers tests",
      );
    }
  } finally {
    leaveSuite();
  }
}

/** What a test declares besides its title and body */
interface TestExtras {
  reason?: string;
  inputs?: Record<string, string>;
  outputs?: string[];
}

function add(
  file: string,
  title: string,
  fn: Body,
  modifier?: Modifier,
  extras: TestExtras = {},
): void {
  const { reason, inputs, outputs } = extras;
  const suite = currentSuite(file);
  const titlePath = [...titlesOf(suite), title];
  const name = titlePath.join(" > ");
  registered.push({
    name,
    titlePath,
    function: fn,
    file,
    suite,
    ...modifierOf({ modifier, ...(reason !== undefined && { reason }) }, suite),
    ...(inputs && { inputs }),
    ...(outputs && { outputs }),
  });
  logger.debug("Registered test %s", name);
}

/** The `describe` titles from the file down to `suite` */
function titlesOf(suite: RegisteredTestCase["suite"]): string[] {
  const titles: string[] = [];
  for (let s: typeof suite | undefined = suite; s; s = s.parent)
    if (s.title !== undefined) titles.unshift(s.title);
  return titles;
}

/** The body and options of `(title, fn)` and `(title, options, fn)`; `describe` only reads `reason` from them */
function bodyAndOptions<F>(
  call: string,
  title: string,
  second: unknown,
  third: unknown,
): {
  fn: F;
  reason?: string;
  inputs?: Record<string, string>;
  outputs?: string[];
} {
  const [options, fn] =
    typeof second === "function"
      ? [undefined, second]
      : [second as TestOptions | undefined, third];
  if (typeof fn !== "function")
    throw new TypeError(
      `${call}(${JSON.stringify(title)}) needs a function as its last argument`,
    );
  const reason = options?.reason;
  return {
    fn: fn as F,
    ...(reason !== undefined && { reason }),
    ...(options && call.startsWith("test") && validateTestIO(call, options)),
  };
}

/** `test()` and `test.only()`: a reason only makes sense with skip and fixme */
function registering(call: string, modifier?: Modifier): TestFunction["only"] {
  return ((title: string, second: unknown, third?: unknown) => {
    const { fn, reason, ...io } = bodyAndOptions<Body>(
      call,
      title,
      second,
      third,
    );
    if (reason !== undefined)
      throw new Error(`${call}(): reason only applies to skip and fixme`);
    // Frames: Error, callerFile, this function, the spec
    add(callerFile(), title, fn, modifier, io);
  }) as TestFunction["only"];
}

/** `test.skip` and `test.fixme`: a title and a body register a test with the modifier; a condition skips the running test */
function skipping(annotation: "skip" | "fixme"): SkipFunction {
  return ((first: string | boolean, second?: unknown, third?: unknown) => {
    if (typeof first === "string") {
      const { fn, ...extras } = bodyAndOptions<Body>(
        `test.${annotation}`,
        first,
        second,
        third,
      );
      // Frames: Error, callerFile, this function, the spec
      add(callerFile(), first, fn, annotation, extras);
      return;
    }
    if (first) throw new SkipSignal(annotation, second as string | undefined);
  }) as SkipFunction;
}

/** `describe.skip` and `describe.fixme`, with or without `{ reason }` */
function describeSkipping(annotation: "skip" | "fixme"): DescribeSkipFunction {
  return ((title: string, second: unknown, third?: unknown) => {
    const { fn, reason } = bodyAndOptions<() => void>(
      `describe.${annotation}`,
      title,
      second,
      third,
    );
    openDescribe(callerFile(), title, fn, annotation, reason);
  }) as DescribeSkipFunction;
}

export const test: TestFunction = Object.assign(registering("test"), {
  skip: skipping("skip"),
  fixme: skipping("fixme"),
  only: registering("test.only", "only"),
});

export const describe: DescribeFunction = Object.assign(
  (title: string, fn: () => void) => openDescribe(callerFile(), title, fn),
  {
    skip: describeSkipping("skip"),
    fixme: describeSkipping("fixme"),
    only: (title: string, fn: () => void) =>
      openDescribe(callerFile(), title, fn, "only"),
  },
);

/** Runs before each test of the `describe` block it is written in (of the file, at the top level) */
export function beforeEach(hook: EachHook): void {
  addHook(currentSuite(callerFile()), "beforeEach", hook);
}

/** Runs after each test of the `describe` block it is written in, also when the test failed */
export function afterEach(hook: EachHook): void {
  addHook(currentSuite(callerFile()), "afterEach", hook);
}

/** Runs once per worker, before the first test of its `describe` block that the worker runs. It gets no page. */
export function beforeAll(hook: AllHook): void {
  addHook(currentSuite(callerFile()), "beforeAll", hook);
}

/** Runs once per worker, when the worker is done, for every `describe` block it ran a `beforeAll` for */
export function afterAll(hook: AllHook): void {
  addHook(currentSuite(callerFile()), "afterAll", hook);
}

export function registeredTests(): readonly RegisteredTestCase[] {
  return registered;
}

/** Forgets every registered test: a run registers its specs afresh */
export function clearRegistry(): void {
  registered.length = 0;
  resetSuites();
}

/** File of the code that called the entry point: stack lines are Error, callerFile, the entry point, the caller */
function callerFile(): string {
  const caller = new Error().stack?.split("\n")[3] ?? "";
  const match =
    caller.match(/\((.+?):\d+:\d+\)$/) ?? caller.match(/at (.+?):\d+:\d+$/);
  const location = match?.[1] ?? "";
  return location.startsWith("file://") ? fileURLToPath(location) : location;
}
