import logger from "./index.js";

const warned = new Set<string>();

/** Logs a warning the first time `key` is seen in this process; later calls with the same key do nothing */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  logger.warn(message);
}

/** Forgets what was warned about (tests) */
export function resetWarnOnce(): void {
  warned.clear();
}
