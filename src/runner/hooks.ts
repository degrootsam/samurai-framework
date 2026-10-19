import type { HookKind } from "./suite.js";

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
    throw new HookError(kind, error);
  } finally {
    clearTimeout(timer);
  }
}
