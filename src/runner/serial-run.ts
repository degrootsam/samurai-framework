import type { SupportedBrowser } from "../types/browser.js";
import type { RegisteredTestCase, TestError } from "../types/test.js";
import type { TestEndExtras, TestSink } from "./reporter.js";
import { SERIAL_SKIP_REASON } from "./serial.js";
import { staticSkip } from "./skip.js";

/** One attempt at one test of the block, reporting to `sink` */
export type BlockTest = (
  test: RegisteredTestCase,
  sink: TestSink,
  attempt: number,
) => Promise<void>;

export interface SerialBlockRun {
  tests: RegisteredTestCase[];
  browser: SupportedBrowser;
  retries: number;
  signal: AbortSignal | undefined;
  runTest: BlockTest;
  /** Called before the block starts again after a failure: closes what the block's tests share (`afterAll`) */
  restart(): Promise<void>;
  sink: TestSink;
}

/** What a test of one attempt ended with, held back until it is known whether the block is run again */
interface Ended {
  error: TestError | undefined;
  extras: TestEndExtras | undefined;
}

/**
 * Runs the tests of a serial block in order. After a failure the rest of the block is reported as skipped; with
 * `retries`, the whole block then runs again from its first test (after `restart`), up to `retries` times.
 * Without retries every test is reported as it ends. With them the ends are held until the block's last attempt is
 * known, as `runWithRetries` does for one test: each test ends once, with `retry` saying which attempt that was.
 * An aborted run is never run again.
 */
export async function serialBlockRun(run: SerialBlockRun): Promise<void> {
  const { tests, browser, retries, signal, sink } = run;
  const live = retries === 0;
  const previous = tests.map((): TestError[] => []);
  for (let attempt = 0; ; attempt++) {
    const ended: (Ended | undefined)[] = [];
    let failedAt = -1;
    for (const [at, test] of tests.entries()) {
      const skip = staticSkip(test);
      if (skip) {
        sink.onTestSkipped(test, browser, skip);
        continue;
      }
      if (signal?.aborted) {
        for (const rest of tests.slice(at)) {
          if (staticSkip(rest)) continue;
          sink.onTestStart(rest, browser);
          sink.onTestEnd(rest, browser, {
            message: "Run aborted",
            type: "error",
          });
        }
        return;
      }
      const attemptSink: TestSink = {
        onTestStart: (t, b) =>
          sink.onTestStart(t, b, attempt > 0 ? attempt : undefined),
        onTestEnd: (t, b, error, extras) => {
          ended[at] = { error, extras };
          if (live) sink.onTestEnd(t, b, error, extras);
        },
        onTestSkipped: (t, b, why) => sink.onTestSkipped(t, b, why),
      };
      await run.runTest(test, attemptSink, attempt);
      if (ended[at]?.error) {
        failedAt = at;
        break;
      }
    }
    const error = ended[failedAt]?.error;
    if (
      error &&
      attempt < retries &&
      !signal?.aborted &&
      error.message !== "Run aborted"
    ) {
      previous[failedAt]!.push(error);
      await run.restart();
      continue;
    }
    if (!live) flush(run, ended, previous, attempt);
    if (failedAt >= 0)
      for (const rest of tests.slice(failedAt + 1)) {
        const skip = staticSkip(rest) ?? {
          annotation: "skip" as const,
          reason: SERIAL_SKIP_REASON,
        };
        sink.onTestSkipped(rest, browser, skip);
      }
    return;
  }
}

/** Reports the held ends of the last attempt, each saying which attempt it was and what failed before */
function flush(
  { tests, browser, sink }: SerialBlockRun,
  ended: (Ended | undefined)[],
  previous: TestError[][],
  attempt: number,
): void {
  for (const [at, test] of tests.entries()) {
    const end = ended[at];
    if (!end) continue;
    const before = previous[at]!;
    sink.onTestEnd(test, browser, end.error, {
      ...end.extras,
      ...(attempt > 0 && {
        retry: attempt,
        previousAttempts: [...before],
        ...(!end.error && before.length > 0 && { flaky: true as const }),
      }),
    });
  }
}
