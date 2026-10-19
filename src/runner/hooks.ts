import type { Suite, TestFixtures } from "../types/test.js";
import { isSkipSignal } from "./skip.js";
import { afterEachOf, beforeEachOf, type HookKind } from "./suite.js";

/** A hook threw or ran out of time: the message names the hook (`beforeEach hook failed: <message>`) */
export class HookError extends Error {
  constructor(
    public readonly kind: HookKind,
    public readonly cause: unknown,
  ) {
    super(
      `${kind} hook failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "HookError";
  }
}

/**
 * Runs one hook with its fixtures and waits for it. Anything it throws, and a hook that is still running after
 * `limitMs` (when given), becomes a `HookError` of that kind.
 */
export async function runHook<F>(
  kind: HookKind,
  hook: (fixtures: F) => Promise<void> | void,
  fixtures: F,
  limitMs?: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const running = Promise.resolve().then(() => hook(fixtures));
    if (limitMs === undefined) return await running;
    await Promise.race([
      running,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${limitMs / 1000} seconds`)),
          limitMs,
        );
      }),
    ]);
  } catch (error) {
    // `test.skip(condition)` in a hook skips the test: it is not a failure of the hook
    if (isSkipSignal(error)) throw error;
    throw new HookError(kind, error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs a test body between the `beforeEach` and `afterEach` hooks of its suites.
 *
 * - A failing `beforeEach` stops the other `beforeEach` hooks and the body; the `afterEach` hooks still run.
 * - The `afterEach` hooks run when the body ended by itself (it passed, threw or skipped), not when `signal` says
 *   the test was cut short (timeout, abort, closed browser): the time or the page is gone. They all run, even
 *   after one fails.
 * - What it throws: the `beforeEach` failure, else the body's error, else the first `afterEach` failure. A skip is
 *   overruled by a failing `afterEach`.
 */
export async function runWithEachHooks(
  suite: Suite,
  fixtures: TestFixtures,
  signal: AbortSignal,
  body: () => Promise<void>,
): Promise<void> {
  let primary: unknown;
  let failed = false;
  try {
    for (const hook of beforeEachOf(suite))
      await runHook("beforeEach", hook, fixtures);
    await body();
  } catch (error) {
    primary = error;
    failed = true;
  }
  let afterError: unknown;
  let afterFailed = false;
  if (!signal.aborted) {
    for (const hook of afterEachOf(suite)) {
      try {
        await runHook("afterEach", hook, fixtures);
      } catch (error) {
        if (!afterFailed) afterError = error;
        afterFailed = true;
      }
    }
  }
  if (afterFailed && (!failed || isSkipSignal(primary))) throw afterError;
  if (failed) throw primary;
}
