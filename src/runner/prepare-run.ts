import { isShortSecret, registerSecret } from "../config/mask.js";
import {
  resolveRunSettings,
  setRunSettings,
  type RunOverrides,
  type RunSettings,
} from "../config/run-settings.js";
import { loadSecrets } from "../config/secrets.js";
import logger from "../logger/index.js";
import type { SamuraiTestConfig } from "../types/config.js";

export interface PreparedRun {
  settings: RunSettings;
  secrets: ReadonlyMap<string, string>;
}

/**
 * Starts a run: picks the environment, loads its secrets and registers every value for masking
 * (all of them, not only the ones a test reads), then makes the settings active.
 */
export function prepareRun(
  config: SamuraiTestConfig,
  overrides: RunOverrides,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): PreparedRun {
  const settings = resolveRunSettings(config, overrides);
  const secrets = loadSecrets(settings.environment, options);
  for (const [name, value] of secrets) {
    registerSecret(name, value);
    if (isShortSecret(value)) {
      logger.warn(`Secret "${name}" is short; masking it may hide unrelated text in logs`);
    }
  }
  setRunSettings(settings);
  return { settings, secrets };
}
