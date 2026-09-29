import { setTimeout as sleep } from "node:timers/promises";
import { readConfig } from "../config/config.js";

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_INTERVAL = 100;

export interface WaitOptions {
  /** Total time (ms) to keep probing; 0 probes exactly once */
  timeout: number;
  /** Time (ms) between probes. @default 100 */
  interval?: number;
}

export class WaitTimeoutError<T> extends Error {
  public readonly timeout: number;
  /** Last completed probe result; undefined when no probe completed */
  public readonly last: T | undefined;

  constructor(timeout: number, last: T | undefined) {
    super(`Condition not met within ${timeout}ms`);
    this.name = "WaitTimeoutError";
    this.timeout = timeout;
    this.last = last;
  }
}

/** Per-call timeout, else config `expect.timeout`, else 5000 */
export async function resolveTimeout(perCall?: number): Promise<number> {
  if (perCall !== undefined) return perCall;
  return (await readConfig("expect"))?.timeout ?? DEFAULT_TIMEOUT;
}

const DEADLINE = Symbol("deadline");

/**
 * Races `probe()` against the time left. Resolves `{ value }` when the probe wins,
 * DEADLINE when the time runs out first; probe errors reject as-is.
 */
function probeBefore<T>(
  probe: () => Promise<T>,
  remaining: number,
): Promise<{ value: T } | typeof DEADLINE> {
  const probing = probe();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), remaining);
  });
  // A probe that loses the race may still fail later; nobody is waiting for it any more
  probing.catch(() => {});
  return Promise.race([probing.then((value) => ({ value })), expired]).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Probes until `isDone(current, previous)` is true and resolves with that result.
 * Always probes at least once; with `timeout > 0` every probe races the time left.
 * Probe errors are rethrown immediately. Throws WaitTimeoutError at the deadline.
 */
export async function waitUntil<T>(
  probe: () => Promise<T>,
  isDone: (current: T, previous: T | undefined) => boolean,
  { timeout, interval = DEFAULT_INTERVAL }: WaitOptions,
): Promise<T> {
  const deadline = Date.now() + timeout;
  let previous: T | undefined;

  for (let first = true; ; first = false) {
    const remaining = deadline - Date.now();
    // Only start a probe while time remains; a later one could only lose the race
    if (!first && remaining <= 0) throw new WaitTimeoutError(timeout, previous);

    // timeout 0 keeps the single probe un-raced so it always completes
    const result = timeout > 0 ? await probeBefore(probe, remaining) : { value: await probe() };
    if (result === DEADLINE) throw new WaitTimeoutError(timeout, previous);
    if (isDone(result.value, previous)) return result.value;
    previous = result.value;

    const left = deadline - Date.now();
    if (left <= 0) throw new WaitTimeoutError(timeout, previous);
    await sleep(Math.min(interval, left));
  }
}
