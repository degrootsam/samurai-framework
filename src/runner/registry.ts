import { fileURLToPath } from "node:url";
import logger from "../logger/index.js";
import type { RegisteredTestCase, TestCaseBase } from "../types/test.js";

const registered: RegisteredTestCase[] = [];
/** Titles of the describe blocks being registered, outermost first */
const titleStack: string[] = [];

/** Groups the tests registered inside `fn` under `title`. `fn` runs immediately and must be synchronous. */
export function describe(title: string, fn: () => void): void {
  titleStack.push(title);
  try {
    const result: unknown = fn();
    if (result instanceof Promise) {
      result.catch(() => {});
      throw new Error("describe() callback must be synchronous; it only registers tests");
    }
  } finally {
    titleStack.pop();
  }
}

export function test(title: string, fn: TestCaseBase["function"]): void {
  const titlePath = [...titleStack, title];
  const name = titlePath.join(" > ");
  registered.push({ name, titlePath, function: fn, file: callerFile() });
  logger.debug("Registered test %s", name);
}

export function registeredTests(): readonly RegisteredTestCase[] {
  return registered;
}

/** Forgets every registered test (tests only) */
export function clearRegistry(): void {
  registered.length = 0;
  titleStack.length = 0;
}

/** File of the code that called test(): stack lines are Error, callerFile, test, caller */
function callerFile(): string {
  const caller = new Error().stack?.split("\n")[3] ?? "";
  const match = caller.match(/\((.+?):\d+:\d+\)$/) ?? caller.match(/at (.+?):\d+:\d+$/);
  const location = match?.[1] ?? "";
  return location.startsWith("file://") ? fileURLToPath(location) : location;
}
