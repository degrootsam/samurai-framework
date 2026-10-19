import type { SupportedBrowser } from "../types/browser.js";
import type { RegisteredTestCase, TestError } from "../types/test.js";
import type { TestEndExtras, TestSink, TestSkip } from "./reporter.js";

/** One attempt at a test: it reports to `sink` and `attempt` counts from 0 */
export type Attempt = (sink: TestSink, attempt: number) => Promise<void>;

/** What an attempt reported as its end, held back until it is known whether the test is run again */
interface HeldEnd {
  error: TestError | undefined;
  extras: TestEndExtras | undefined;
}

/**
 * Runs a test, and again after a failure with a fresh browser, up to `retries` more times. The test starts once
 * per attempt (`retry` counts from 1), and ends once, with the last attempt's result: `retry` says which attempt
 * that was, `previousAttempts` holds the errors before it, and `flaky` marks a pass after a failure.
 *
 * An aborted run is never run again. A test that skips itself ends there and then.
 */
export async function runWithRetries(
  test: RegisteredTestCase,
  browser: SupportedBrowser,
  retries: number,
  signal: AbortSignal | undefined,
  attempt: Attempt,
  sink: TestSink,
): Promise<void> {
  if (retries <= 0) return attempt(sink, 0);
  const previous: TestError[] = [];
  for (let n = 0; ; n++) {
    let held: HeldEnd | undefined;
    const attemptSink: TestSink = {
      onTestStart: (t, b) => sink.onTestStart(t, b, n > 0 ? n : undefined),
      onTestEnd: (_t, _b, error, extras) => {
        held = { error, extras };
      },
      onTestSkipped: (t, b, skip: TestSkip) => sink.onTestSkipped(t, b, skip),
    };
    await attempt(attemptSink, n);
    // Skipped: already reported, and nothing is run again
    if (!held) return;
    const { error, extras } = held as HeldEnd;
    if (
      error &&
      n < retries &&
      !signal?.aborted &&
      error.message !== "Run aborted"
    ) {
      previous.push(error);
      continue;
    }
    sink.onTestEnd(test, browser, error, {
      ...extras,
      ...(n > 0 && {
        retry: n,
        previousAttempts: [...previous],
        ...(!error && { flaky: true as const }),
      }),
    });
    return;
  }
}
