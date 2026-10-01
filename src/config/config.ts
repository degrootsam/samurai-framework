import type { SamuraiTestConfig } from "../types/config.js";
import path from "path";
import logger from "../logger/index.js";
import { pathToFileURL } from "url";

/** The whole `samurai.config.ts` of the current working directory */
export async function loadConfig(): Promise<SamuraiTestConfig> {
  const configUrl = path.join(process.cwd(), "samurai.config.ts");
  logger.debug("Reading config from: %s", configUrl);

  const config = (await import(pathToFileURL(configUrl).href)) as {
    default?: SamuraiTestConfig;
  };

  if (!config.default) {
    throw new Error(
      "samurai.config.ts does not export defineConfig as default!",
    );
  }
  return config.default;
}

export async function readConfig<K extends keyof SamuraiTestConfig>(
  key: K,
): Promise<SamuraiTestConfig[K]> {
  const value = (await loadConfig())[key];
  logger.debug("Resolved config value: ", { value });
  return value;
}

export function defineConfig(config: SamuraiTestConfig) {
  return config;
}
