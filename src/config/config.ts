import type { SamuraiTestConfig } from "../types/config.js";
import path from "path";
import logger from "../logger/index.js";
import { pathToFileURL } from "url";

export async function readConfig(key: keyof SamuraiTestConfig) {
  logger.verbose("Reading config value: %s", key);
  const configUrl = path.join(process.cwd(), "samurai.config.ts");
  logger.debug("Reading config from: %s", configUrl);

  const config = (await import(pathToFileURL(configUrl).href)) as {
    default: SamuraiTestConfig;
  };

  if (!("default" in config)) {
    throw new Error(
      "samurai.config.ts does not export defineConfig as default!",
    );
  }
  return config.default[key];
}

export function defineConfig(config: SamuraiTestConfig) {
  return config;
}
