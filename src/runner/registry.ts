import { fileURLToPath } from "node:url";
import logger from "../logger/index.js";
import type {
  Modifier,
  RegisteredTestCase,
  TestCaseBase,
} from "../types/test.js";
import { SkipSignal } from "./skip.js";
import {
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
  /** Registers a test that is not run */
  skip: SkipFunction;
  /** Registers a test that is not run because it is known to be broken */
  fixme: SkipFunction;
  /** Runs only this test (and the other `only` ones) */
  only(title: string, fn: Body): void;
}

/** With a title and a body it registers a skipped test; with a condition it skips the running test when the condition is true */
interface SkipFunction {
  (title: string, fn: Body): void;
  (condition: boolean, reason?: string): void;
}

/** `describe(title, fn)` and the same with a modifier on every test inside */
export interface DescribeFunction {
  (title: string, fn: () => void): void;
  skip(title: string, fn: () => void): void;
  fixme(title: string, fn: () => void): void;
  only(title: string, fn: () => void): void;
}

/** Runs `fn` as the `describe` block `title`, under `modifier` when there is one. `fn` runs immediately and must be synchronous. */
function openDescribe(
  file: string,
  title: string,
  fn: () => void,
  modifier?: Modifier,
): void {
  enterSuite(file, title, modifier);
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

function add(file: string, title: string, fn: Body, modifier?: Modifier): void {
  const suite = currentSuite(file);
  const titlePath = [...titlesOf(suite), title];
  const name = titlePath.join(" > ");
  const effective = modifierOf(modifier, suite);
  registered.push({
    name,
    titlePath,
    function: fn,
    file,
    suite,
    ...(effective && { modifier: effective }),
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

/** `test.skip` and `test.fixme`: a title and a body register a test with the modifier; a condition skips the running test */
function skipping(annotation: "skip" | "fixme"): SkipFunction {
  return ((first: string | boolean, second?: Body | string) => {
    if (typeof first === "string") {
      // Frames: Error, callerFile, this function, the spec
      add(callerFile(), first, second as Body, annotation);
      return;
    }
    if (first) throw new SkipSignal(annotation, second as string | undefined);
  }) as SkipFunction;
}

export const test: TestFunction = Object.assign(
  (title: string, fn: Body) => add(callerFile(), title, fn),
  {
    skip: skipping("skip"),
    fixme: skipping("fixme"),
    only: (title: string, fn: Body) => add(callerFile(), title, fn, "only"),
  },
);

export const describe: DescribeFunction = Object.assign(
  (title: string, fn: () => void) => openDescribe(callerFile(), title, fn),
  {
    skip: (title: string, fn: () => void) =>
      openDescribe(callerFile(), title, fn, "skip"),
    fixme: (title: string, fn: () => void) =>
      openDescribe(callerFile(), title, fn, "fixme"),
    only: (title: string, fn: () => void) =>
      openDescribe(callerFile(), title, fn, "only"),
  },
);

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
