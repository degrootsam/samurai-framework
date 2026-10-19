import type EventEmitter from "node:events";
import logger from "../logger/index.js";

/**
 * Calls the listeners of `event` in order with `args`. A listener that throws is logged, not rethrown: it must not
 * stop the other listeners or the code that raised the event. `rawListeners` so the wrappers that make a `once`
 * listener remove itself are called.
 */
export function emitSafely(
  emitter: EventEmitter,
  event: string,
  args: unknown[],
  label: string = event,
): void {
  for (const listener of emitter.rawListeners(event)) {
    try {
      (listener as (...values: unknown[]) => unknown)(...args);
    } catch (err) {
      logger.error("A %s listener threw", label, { err });
    }
  }
}
