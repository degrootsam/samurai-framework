import type { SamuraiTestConfig } from "../types/config.js";

/**
 * Reads a `retries` value: a whole number from 0, as a number or as text. `where` names the source (`--retries`,
 * `SAMURAI_RETRIES`, a config key) in the error.
 */
export function parseRetries(value: unknown, where: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0)
    return value;
  if (typeof value === "string" && /^\s*\d+\s*$/.test(value))
    return Number(value.trim());
  throw new Error(
    `${where} must be a whole number from 0, got "${String(value)}"`,
  );
}

/** Checks the `retries` key of a config. Throws an Error that names the key */
export function validateRetriesConfig(config: SamuraiTestConfig): void {
  if (config.retries === undefined) return;
  if (typeof config.retries !== "number")
    throw new Error(
      `retries must be a whole number from 0, got "${String(config.retries)}"`,
    );
  parseRetries(config.retries, "retries");
}
