import { AsyncLocalStorage } from "node:async_hooks";
import type { TestStepEntry } from "../types/test.js";
import { checkTimeout } from "./test-timeout.js";
import { isSkipSignal } from "./skip.js";

/** The steps a test has run, in the order they started */
export class StepLog {
  public readonly entries: TestStepEntry[] = [];
}

/** The step being run: a step started inside it is listed under it */
const running = new AsyncLocalStorage<TestStepEntry>();

const UNFINISHED = "the test ended before the step finished";

/**
 * `test.step`: runs `body` as a step of `log`, nested under the step it is called in. The step is listed with how
 * it ended; a throw fails the step and goes on. A step that outlasts `options.timeout` fails with a timeout error
 * (its body keeps running, as nothing can stop it).
 */
export async function runStep<T>(
  log: StepLog,
  title: unknown,
  body: unknown,
  options?: { timeout?: number },
): Promise<T> {
  if (typeof title !== "string" || title === "")
    throw new TypeError("step(): the title must be a non-empty string");
  if (typeof body !== "function")
    throw new TypeError("step(): needs a function as its second argument");
  const limit =
    options?.timeout === undefined
      ? 0
      : checkTimeout("step()", options.timeout);
  // Listed as unfinished until it ends, so a test cut short still shows where it stopped
  const entry: TestStepEntry = {
    title,
    status: "failed",
    duration: 0,
    error: UNFINISHED,
  };
  const parent = running.getStore();
  if (parent) (parent.steps ??= []).push(entry);
  else log.entries.push(entry);
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const call = Promise.resolve().then(() =>
      running.run(entry, body as () => Promise<T> | T),
    );
    const value =
      limit === 0
        ? await call
        : await Promise.race([
            call,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      `step ${JSON.stringify(title)} timed out after ${limit} ms`,
                    ),
                  ),
                limit,
              );
            }),
          ]);
    entry.status = "passed";
    delete entry.error;
    return value;
  } catch (error) {
    if (isSkipSignal(error)) {
      entry.status = "skipped";
      delete entry.error;
    } else entry.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    clearTimeout(timer);
    entry.duration = Date.now() - started;
  }
}
