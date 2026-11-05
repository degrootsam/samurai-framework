import type { FixtureDef } from "./fixture-defs.js";

/** A custom fixture whose setup threw or never called `use` */
export class FixtureSetupError extends Error {
  constructor(name: string, cause: unknown) {
    super(`fixture "${name}" setup failed: ${messageOf(cause)}`);
    this.name = "FixtureSetupError";
    if (cause instanceof Error && cause.stack) this.stack = cause.stack;
  }
}

export const messageOf = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** A fixture that is set up: `release` lets its setup function finish, `done` is that function's end */
export interface Started {
  name: string;
  release: () => void;
  done: () => Promise<void>;
}

/** Runs `setup` until it calls `use`; resolves with the value and the means to finish it */
export function startSetup(
  def: FixtureDef,
  args: Record<string, unknown>,
): Promise<{ value: unknown; release: () => void; done: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    let release: () => void = () => {};
    const released = new Promise<void>((r) => (release = r));
    let used = false;
    let running: Promise<void> | undefined;
    const done = () => running ?? Promise.resolve();
    const use = async (value: unknown) => {
      if (used) throw new Error("use() was called twice");
      used = true;
      resolve({ value, release, done });
      await released;
    };
    running = (async () => def.setup?.(args, use))();
    running.then(
      () => {
        if (!used) reject(new Error("the setup never called use()"));
      },
      (err: unknown) => {
        if (!used) reject(err);
      },
    );
    // A failure after use() is read by teardown; this keeps it from being reported as unhandled meanwhile
    running.catch(() => {});
  });
}
