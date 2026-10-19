import type { SamuraiTestConfig } from "../types/config.js";

/** A number of workers, or a share of the CPUs */
export type ParsedWorkers = { count: number } | { percent: number };

/**
 * Reads a `workers` value: a whole number from 1, as a number or as text, or a percentage like `50%` when
 * `percentages` is on. `where` names the source (`--workers`, `SAMURAI_WORKERS`, a config key) in the error.
 */
export function parseWorkers(
  value: unknown,
  where: string,
  percentages = true,
): ParsedWorkers {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1)
    return { count: value };
  if (typeof value === "string") {
    const text = value.trim();
    if (/^\d+$/.test(text) && Number(text) >= 1) return { count: Number(text) };
    const share = /^(\d+)%$/.exec(text);
    if (percentages && share) {
      const percent = Number(share[1]);
      if (percent >= 1 && percent <= 100) return { percent };
    }
  }
  throw new Error(
    `${where} must be a whole number from 1${percentages ? " or a percentage like 50%" : ""}, got "${String(value)}"`,
  );
}

/** Checks the `workers` keys of a config: the project's and each group's. Throws an Error that names the key */
export function validateWorkersConfig(config: SamuraiTestConfig): void {
  if (config.workers !== undefined) parseWorkers(config.workers, "workers");
  config.groups?.forEach((group, index) => {
    if (group.workers !== undefined)
      parseWorkers(group.workers, `groups[${index}].workers`, false);
  });
}
