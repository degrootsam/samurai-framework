import { existsSync } from "node:fs";
import { projectConfig, projectDir, readConfig } from "../config/config.js";
import logger from "../logger/index.js";
import type { SamuraiTestConfig } from "../types/config.js";
import { ENV_PATH, overrideOf, type OverrideSources } from "./overrides.js";
import { MANAGED_BROWSERS, type ManagedBrowser } from "./pins.js";
import {
  managedExecutable,
  statusOf,
  type BrowserStatus,
  type StoreOptions,
} from "./store.js";

/** The binary a launch uses: the env path, else the config's `browserPaths`, else the pinned build. Never downloads */
export function resolveExecutable(
  name: ManagedBrowser,
  sources: OverrideSources & StoreOptions = {},
): string {
  const override = overrideOf(name, sources);
  if (!override) return managedExecutable(name, sources);
  if (!existsSync(override.path))
    throw new Error(
      override.from === "env"
        ? `${ENV_PATH[name]} points to a missing file: ${override.path}`
        : `browserPaths.${name} in samurai.config.ts points to a missing file: ${override.path}`,
    );
  return override.path;
}

/** `resolveExecutable` for the active project, with its config's `browserPaths` (none when the config can't be read) */
export async function projectExecutable(name: ManagedBrowser): Promise<string> {
  let browserPaths: SamuraiTestConfig["browserPaths"];
  try {
    browserPaths = await readConfig("browserPaths");
  } catch (err) {
    logger.debug("Could not read browserPaths from config", { err });
  }
  return resolveExecutable(name, { browserPaths, projectDir: projectDir() });
}

/** Every pinned browser's status for a project (default: the working directory); a config that can't be read gives no config overrides */
export async function browserStatus(
  options: StoreOptions & {
    projectDir?: string;
    config?: SamuraiTestConfig;
    env?: Partial<NodeJS.ProcessEnv>;
  } = {},
): Promise<BrowserStatus[]> {
  const dir = options.projectDir ?? process.cwd();
  let browserPaths: SamuraiTestConfig["browserPaths"];
  try {
    browserPaths = (await projectConfig({ ...options, projectDir: dir }))
      .browserPaths;
  } catch (err) {
    logger.debug("Could not read browserPaths from config", { err });
  }
  return MANAGED_BROWSERS.map((name) =>
    statusOf(name, { ...options, browserPaths, projectDir: dir }),
  );
}
