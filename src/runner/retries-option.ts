import { DEFAULT_RETRIES } from "../config/defaults.js";
import { parseRetries } from "../config/retries.js";

export interface RetriesInput {
  /** The command line's `--retries` (or the `retries` run option) */
  flag?: number | string | undefined;
  /** `SAMURAI_RETRIES` */
  env?: string | undefined;
  /** The config's `retries` */
  config?: number | string | undefined;
}

/** How many times a failing test is run again: the flag, else `SAMURAI_RETRIES`, else the config's `retries`, else 0 */
export function resolveRetries({ flag, env, config }: RetriesInput): number {
  const fromEnv = env?.trim() ? env : undefined;
  if (flag !== undefined) return parseRetries(flag, "--retries");
  if (fromEnv !== undefined) return parseRetries(fromEnv, "SAMURAI_RETRIES");
  if (config !== undefined) return parseRetries(config, "retries");
  return DEFAULT_RETRIES;
}
