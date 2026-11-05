import { fileURLToPath } from "node:url";
import logger from "../logger/index.js";
import type {
  AllHook,
  EachHook,
  Modifier,
  SuiteMode,
  RegisteredTestCase,
  TestFixtures,
  TestOptions,
} from "../types/test.js";
import type { FixtureUse, UseOptions } from "../types/use.js";
import type {
  Body,
  DescribeFunction,
  DescribeSkipFunction,
  ConditionFunction,
  FailFunction,
  NoFixtures,
  SkipFunction,
  TestFunction,
} from "./test-function.js";
import { extendLayers, type FixtureLayers } from "./fixture-defs.js";
import { rememberLayers } from "./fixture-registry.js";
import { checkTestFixtureUse } from "./fixture-use.js";
import { validateUseOptions } from "../config/use-options.js";
import {
  currentStepLog,
  currentTestInfo,
  infoFor,
  skipFromCondition,
} from "./test-info.js";
import { runStep } from "./steps.js";
import { markTests } from "./test-annotations.js";
import { validateTestIO } from "./test-io.js";
import {
  addHook,
  addUse,
  currentSuite,
  enterSuite,
  leaveSuite,
  modifierOf,
  resetSuites,
} from "./suite.js";
import { configureSuite } from "./serial.js";

const registered: RegisteredTestCase[] = [];

/** Runs `fn` as the `describe` block `title`, under `modifier` when there is one. `fn` runs immediately and must be synchronous. */
function openDescribe(
  file: string,
  title: string,
  fn: () => void,
  modifier?: Modifier,
  reason?: string,
  mode?: SuiteMode,
): void {
  enterSuite(file, title, modifier, reason, mode);
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
  /** The custom fixtures of the `test` the test was written with */
  extension?: FixtureLayers;
  reason?: string;
  inputs?: Record<string, string>;
  outputs?: string[];
  /** Registered with `test.fail("title", fn)` */
  expectedFail?: { description?: string };
}

function add(
  { file, line, column }: Location,
  title: string,
  fn: Body,
  modifier?: Modifier,
  extras: TestExtras = {},
): void {
  const { reason, inputs, outputs, extension, expectedFail } = extras;
  const suite = currentSuite(file);
  const titlePath = [...titlesOf(suite), title];
  const name = titlePath.join(" > ");
  registered.push({
    name,
    titlePath,
    function: fn,
    file,
    ...(line !== undefined && { line, column }),
    suite,
    ...modifierOf({ modifier, ...(reason !== undefined && { reason }) }, suite),
    ...(inputs && { inputs }),
    ...(outputs && { outputs }),
    ...(extension && { extension }),
    ...(expectedFail && { expectedFail }),
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
function registering(
  call: string,
  modifier?: Modifier,
  extension?: FixtureLayers,
): TestFunction["only"] {
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
    add(callerLocation(), title, fn, modifier, {
      ...io,
      ...(extension && { extension }),
    });
  }) as TestFunction["only"];
}

/** `test.skip` and `test.fixme`: a title and a body register a test with the modifier; a condition skips the running test */
function skipping(
  annotation: "skip" | "fixme",
  extension?: FixtureLayers,
): SkipFunction<NoFixtures> {
  return ((
    first: string | boolean | ((fixtures: TestFixtures) => boolean),
    second?: unknown,
    third?: unknown,
  ) => {
    if (typeof first === "string") {
      const { fn, ...extras } = bodyAndOptions<Body>(
        `test.${annotation}`,
        first,
        second,
        third,
      );
      // Frames: Error, callerFile, this function, the spec
      add(callerLocation(), first, fn, annotation, {
        ...extras,
        ...(extension && { extension }),
      });
      return;
    }
    skipFromCondition(annotation, first, second as string | undefined);
  }) as SkipFunction<NoFixtures>;
}

/**
 * `test.fail`: a title and a body register a test that is expected to fail; otherwise the running test (or, in a
 * `describe` block, every test in it) is marked
 */
function failing(extension?: FixtureLayers): FailFunction<NoFixtures> {
  return ((first: unknown, second?: unknown, third?: unknown) => {
    if (typeof first !== "string") {
      // Frames: Error, callerFile, this function, the spec
      const file = callerFile();
      return markTests(
        "fail",
        () => currentSuite(file),
        first as boolean | undefined,
        second as string | undefined,
      );
    }
    const { fn, reason, ...io } = bodyAndOptions<Body>(
      "test.fail",
      first,
      second,
      third,
    );
    // Frames: Error, callerFile, this function, the spec
    add(callerLocation(), first, fn, undefined, {
      ...io,
      expectedFail: { ...(reason !== undefined && { description: reason }) },
      ...(extension && { extension }),
    });
  }) as FailFunction<NoFixtures>;
}

/** `test.slow`: triples the timeout of the running test, or of every test of the `describe` block it is written in */
const slow = ((condition?: boolean, reason?: string) => {
  // Frames: Error, callerFile, this function, the spec
  const file = callerFile();
  markTests("slow", () => currentSuite(file), condition, reason);
}) as ConditionFunction<NoFixtures>;

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

export const describe: DescribeFunction = Object.assign(
  (title: string, fn: () => void) => openDescribe(callerFile(), title, fn),
  {
    skip: describeSkipping("skip"),
    fixme: describeSkipping("fixme"),
    only: (title: string, fn: () => void) =>
      openDescribe(callerFile(), title, fn, "only"),
    configure: (options: { mode: SuiteMode }) =>
      configureSuite(currentSuite(callerFile()), options),
    serial: (title: string, fn: () => void) =>
      openDescribe(callerFile(), title, fn, undefined, undefined, "serial"),
    parallel: (title: string, fn: () => void) =>
      openDescribe(callerFile(), title, fn, undefined, undefined, "parallel"),
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

/** `test.use(options)` of a test with the fixtures `extension`: checked now, applied when each test of the scope runs */
function usingFor(extension?: FixtureLayers) {
  return (options: UseOptions & FixtureUse): void => {
    const checked = validateUseOptions(options);
    // `fixtures` and option fixtures may only name what this test's `test.extend()` defines
    checkTestFixtureUse(checked, extension);
    addUse(currentSuite(callerFile()), checked);
  };
}

/**
 * A `test` that registers its tests with the custom fixtures `extension`. The aliases are the same functions as
 * the named exports: they find the spec file from the stack, so they must not be wrapped.
 */
function makeTest(extension?: FixtureLayers): TestFunction<never> {
  const made = Object.assign(registering("test", undefined, extension), {
    skip: skipping("skip", extension),
    fixme: skipping("fixme", extension),
    fail: failing(extension),
    slow,
    setTimeout: (ms: number) => infoFor("setTimeout()").setTimeout(ms),
    step: (
      title: string,
      body: () => unknown,
      options?: { timeout?: number },
    ) => runStep(currentStepLog(), title, body, options),
    only: registering("test.only", "only", extension),
    info: currentTestInfo,
    use: usingFor(extension),
    describe,
    beforeEach,
    afterEach,
    beforeAll,
    afterAll,
    extend: (fixtures: unknown) => makeTest(extendLayers(extension, fixtures)),
  }) as unknown as TestFunction<never>;
  if (extension) rememberLayers(made, extension);
  return made;
}

export const test: TestFunction = makeTest() as unknown as TestFunction;

export function registeredTests(): readonly RegisteredTestCase[] {
  return registered;
}

/** Forgets every registered test: a run registers its specs afresh */
export function clearRegistry(): void {
  registered.length = 0;
  resetSuites();
}

/** Where the code that called the entry point is */
interface Location {
  file: string;
  line?: number;
  column?: number;
}

/** The place of the caller: stack lines are Error, callerLocation, the entry point, the caller */
function callerLocation(): Location {
  const caller = new Error().stack?.split("\n")[3] ?? "";
  return parseFrame(caller);
}

/** File of the code that called the entry point (the same frames as `callerLocation`) */
function callerFile(): string {
  return parseFrame(new Error().stack?.split("\n")[3] ?? "").file;
}

function parseFrame(frame: string): Location {
  const match =
    frame.match(/\((.+?):(\d+):(\d+)\)$/) ??
    frame.match(/at (.+?):(\d+):(\d+)$/);
  const location = match?.[1] ?? "";
  const file = location.startsWith("file://")
    ? fileURLToPath(location)
    : location;
  return match
    ? { file, line: Number(match[2]), column: Number(match[3]) }
    : { file };
}
