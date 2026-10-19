import type { SamuraiTestConfig } from "../types/config.js";

/** Checks the `forbidOnly` key of a config. Throws an Error that names the key */
export function validateForbidOnlyConfig(config: SamuraiTestConfig): void {
  if (config.forbidOnly !== undefined && typeof config.forbidOnly !== "boolean")
    throw new Error(
      `forbidOnly must be true or false, got "${String(config.forbidOnly)}"`,
    );
}

/** Whether `test.only` is refused: the config's `forbidOnly`, else on when `CI` is set */
export function forbidsOnly(
  config: SamuraiTestConfig,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean {
  return config.forbidOnly ?? Boolean(env.CI);
}
