import { existsSync } from "node:fs";
import { projectConfig, projectDir, readConfig } from "../config/config.js";
import logger from "../logger/index.js";
import type { SamuraiTestConfig } from "../types/config.js";
import {
  ENV_CHROMEDRIVER_PATH,
  ENV_PATH,
  overrideOf,
  type OverrideSources,
} from "./overrides.js";
import { MANAGED_BROWSERS, PINNED, type ManagedBrowser } from "./pins.js";
import {
  managedBuildDir,
  managedChromedriver,
  managedExecutable,
  statusOf,
  type BrowserStatus,
  type StoreOptions,
} from "./store.js";

/** The browser a launch uses, and how to name it */
export interface ResolvedBrowser {
  executablePath: string;
  /** "Firefox 158.0" for the managed build, else "Firefox" */
  label: string;
  /** The managed build's folder; undefined when an env or config path is used instead */
  buildDir?: string;
  /** Chrome only: the chromedriver that starts it and speaks BiDi for it */
  driverPath?: string;
}

/** The browser a launch uses: the env path, else the config's `browserPaths`, else the pinned build. Never downloads */
export function resolveBrowser(
  name: ManagedBrowser,
  sources: OverrideSources & StoreOptions = {},
): ResolvedBrowser {
  const driverPath =
    name === "chrome" ? resolveChromedriver(sources) : undefined;
  const override = overrideOf(name, sources);
  if (!override)
    return {
      executablePath: managedExecutable(name, sources),
      label: PINNED[name].label,
      buildDir: managedBuildDir(name, sources),
      ...(driverPath && { driverPath }),
    };
  if (!existsSync(override.path))
    throw new Error(
      override.from === "env"
        ? `${ENV_PATH[name]} points to a missing file: ${override.path}`
        : `browserPaths.${name} in samurai.config.ts points to a missing file: ${override.path}`,
    );
  return {
    executablePath: override.path,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    ...(driverPath && { driverPath }),
  };
}

/** `SAMURAI_CHROMEDRIVER_PATH` (which must exist), else the chromedriver installed with the pinned Chrome */
function resolveChromedriver(sources: OverrideSources & StoreOptions): string {
  const fromEnv = (sources.env ?? process.env)[ENV_CHROMEDRIVER_PATH];
  if (!fromEnv) return managedChromedriver(sources);
  if (!existsSync(fromEnv))
    throw new Error(
      `${ENV_CHROMEDRIVER_PATH} points to a missing file: ${fromEnv}`,
    );
  return fromEnv;
}

/** The binary a launch uses; see `resolveBrowser` */
export function resolveExecutable(
  name: ManagedBrowser,
  sources: OverrideSources & StoreOptions = {},
): string {
  return resolveBrowser(name, sources).executablePath;
}

/** `resolveExecutable` for the active project */
export async function projectExecutable(name: ManagedBrowser): Promise<string> {
  return (await projectBrowser(name)).executablePath;
}

/** `resolveBrowser` for the active project, with its config's `browserPaths` (none when the config can't be read) */
export async function projectBrowser(
  name: ManagedBrowser,
): Promise<ResolvedBrowser> {
  let browserPaths: SamuraiTestConfig["browserPaths"];
  try {
    browserPaths = await readConfig("browserPaths");
  } catch (err) {
    logger.debug("Could not read browserPaths from config", { err });
  }
  return resolveBrowser(name, { browserPaths, projectDir: projectDir() });
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
