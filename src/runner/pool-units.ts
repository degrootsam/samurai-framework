import type { TestError, TestResult } from "../types/test.js";
import { SERIAL_SKIP_REASON } from "./serial.js";
import type { WorkItem } from "./worker-protocol.js";

/** The error a failed result carries, as the next result lists it in `previousAttempts` */
export function errorOf(result: TestResult): TestError {
  const { message, type, stack, expected, actual } =
    result as Partial<TestError>;
  return {
    message: message ?? "The test failed",
    type: type ?? "error",
    ...(stack !== undefined && { stack }),
    ...(expected !== undefined && { expected }),
    ...(actual !== undefined && { actual }),
  };
}

/** The result of a test of a serial block that did not run, because an earlier test of the block failed */
export function serialSkipped(item: WorkItem): TestResult {
  return {
    name: item.testName,
    file: item.file,
    browser: item.browser,
    status: "skipped",
    startTime: Date.now(),
    duration: 0,
    annotation: "skip",
    reason: SERIAL_SKIP_REASON,
  };
}

/** What the pool keeps of a queued item: the item, and whatever else it needs to find its place again */
interface Held<E> {
  entry: E;
  result: TestResult;
}

/**
 * A serial block as the pool runs it. With retries the results are held until the block's last attempt is known,
 * so a test ends once, saying which attempt that was; without, the pool reports them as they come and uses this
 * only to count the attempts.
 */
export class UnitState<E extends { item: WorkItem }> {
  /** Which attempt at the block this is, counting from 0 */
  attempt = 0;
  private held: Held<E>[] = [];
  private readonly previous = new Map<E, TestError[]>();

  constructor(readonly call: unknown) {}

  hold(entry: E, result: TestResult): void {
    this.held.push({ entry, result });
  }

  /** The block failed and runs again: forgets this attempt's results, remembers the error and returns the entries to queue again, in order */
  restart(failed: E, result: TestResult): E[] {
    const entries = this.held.map(({ entry }) => entry);
    this.held = [];
    const errors = this.previous.get(failed) ?? [];
    errors.push(errorOf(result));
    this.previous.set(failed, errors);
    this.attempt++;
    return entries;
  }

  /** The held results of the last attempt, each saying which attempt it was and what failed before; they are not held any more */
  release(): Held<E>[] {
    const released = this.held.map(({ entry, result }) => {
      const before = this.previous.get(entry) ?? [];
      return {
        entry,
        result: {
          ...result,
          ...(this.attempt > 0 && {
            retry: this.attempt,
            previousAttempts: [...before],
            ...(result.status === "success" &&
              before.length > 0 && { flaky: true as const }),
          }),
        } as TestResult,
      };
    });
    this.held = [];
    return released;
  }
}

/** The result of an item that ended without one: the worker died, or the run was aborted */
export function failedResult(
  item: WorkItem,
  message: string,
  startTime = Date.now(),
): TestResult {
  return {
    name: item.testName,
    file: item.file,
    browser: item.browser,
    status: "failed",
    type: "error",
    message,
    startTime,
    duration: Date.now() - startTime,
  };
}
