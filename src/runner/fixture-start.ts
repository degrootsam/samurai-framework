import type { FixtureDef } from "./fixture-defs.js";

/** A custom fixture whose setup threw or never called `use` */
export class FixtureSetupError extends Error {
  constructor(name: string, cause: unknown) {
    super(`fixture "${name}" setup failed: ${messageOf(cause)}`);
    this.name = "FixtureSetupError";
    if (cause instanceof Error && cause.stack) this.stack = cause.stack;
  }
}

const messageOf = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** A fixture that is set up: `release` lets its setup function finish, `done` is that function's end */
export interface Started {
  name: string;
  release: () => void;
  done: () => Promise<void>;
  /** The fixture's own `timeout` for its teardown */
  timeout?: number | undefined;
}

/**
 * Runs `setup` until it calls `use`; resolves with the value and the means to finish it. A setup that takes longer
 * than `limitMs` fails; if it calls `use` later anyway, it is let go at once.
 */
export function startSetup(
  def: FixtureDef,
  args: Record<string, unknown>,
  limitMs?: number,
): Promise<{ value: unknown; release: () => void; done: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    let release: () => void = () => {};
    const released = new Promise<void>((r) => (release = r));
    let used = false;
    let running: Promise<void> | undefined;
    const done = () => running ?? Promise.resolve();
    const timer =
      limitMs === undefined
        ? undefined
        : setTimeout(() => {
            release();
            reject(new Error(`timed out after ${limitMs / 1000} seconds`));
          }, limitMs);
    const use = async (value: unknown) => {
      if (used) throw new Error("use() was called twice");
      used = true;
      clearTimeout(timer);
      resolve({ value, release, done });
      await released;
    };
    running = (async () => def.setup?.(args, use))();
    running.then(
      () => {
        clearTimeout(timer);
        if (!used) reject(new Error("the setup never called use()"));
      },
      (err: unknown) => {
        clearTimeout(timer);
        if (!used) reject(err);
      },
    );
    // A failure after use() is read by teardown; this keeps it from being reported as unhandled meanwhile
    running.catch(() => {});
  });
}

/**
 * Lets a set-up fixture finish its cleanup, within the fixture's own `timeout` else `limitMs`. Returns the error
 * (`fixture "x" teardown failed: ...`) when the cleanup threw or ran out of time.
 */
export async function finishWithin(
  one: Started,
  limitMs: number,
): Promise<Error | undefined> {
  one.release();
  const limit = one.timeout ?? limitMs;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      one.done(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${limit / 1000} seconds`)),
          limit,
        );
      }),
    ]);
    return undefined;
  } catch (err) {
    const failure = new Error(
      `fixture "${one.name}" teardown failed: ${messageOf(err)}`,
    );
    if (err instanceof Error && err.stack) failure.stack = err.stack;
    return failure;
  } finally {
    clearTimeout(timer);
  }
}
