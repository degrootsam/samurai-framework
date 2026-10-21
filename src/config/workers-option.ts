import { availableParallelism } from "node:os";
import { parseWorkers } from "./workers.js";

export interface WorkersInput {
  /** The command line's `--workers` (or the `workers` run option) */
  flag?: number | string | undefined;
  /** `SAMURAI_WORKERS` */
  env?: string | undefined;
  /** The config's `workers` */
  config?: number | string | undefined;
  /** The number of CPUs; for tests. @default the machine's */
  cpus?: number;
}

/**
 * How many workers a run uses: the flag, else `SAMURAI_WORKERS`, else the config's `workers`, else half the CPUs.
 * A percentage is a share of the CPUs. At least 1.
 */
export function resolveWorkers({
  flag,
  env,
  config,
  cpus = availableParallelism(),
}: WorkersInput): number {
  const fromEnv = env?.trim() ? env : undefined;
  const [value, where] =
    flag !== undefined
      ? [flag, "--workers"]
      : fromEnv !== undefined
        ? [fromEnv, "SAMURAI_WORKERS"]
        : config !== undefined
          ? [config, "workers"]
          : [undefined, ""];
  if (value === undefined) return Math.max(1, Math.floor(cpus / 2));
  const parsed = parseWorkers(value, where);
  return "count" in parsed
    ? parsed.count
    : Math.max(1, Math.floor((cpus * parsed.percent) / 100));
}
