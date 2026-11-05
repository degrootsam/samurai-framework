import type { SamuraiTestConfig } from "../types/config.js";

/** Checks the `fullyParallel` key of a config. Throws an Error that names the key */
export function validateFullyParallelConfig(config: SamuraiTestConfig): void {
  if (
    config.fullyParallel !== undefined &&
    typeof config.fullyParallel !== "boolean"
  )
    throw new Error(
      `fullyParallel must be true or false, got ${JSON.stringify(config.fullyParallel)}`,
    );
}
