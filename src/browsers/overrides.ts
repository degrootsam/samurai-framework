import path from "node:path";
import type { ManagedBrowser } from "./pins.js";

/** A browser binary set on purpose, and where */
export interface Override {
  path: string;
  from: "env" | "config";
}

/** Where the overrides come from; each defaults to the running process */
export interface OverrideSources {
  env?: Partial<NodeJS.ProcessEnv>;
  /** `browserPaths` of samurai.config.ts */
  browserPaths?: Partial<Record<ManagedBrowser, string>> | undefined;
  /** What relative `browserPaths` resolve from */
  projectDir?: string;
}

/** Chrome is driven through a chromedriver of the same major version; this points a launch at another one */
export const ENV_CHROMEDRIVER_PATH = "SAMURAI_CHROMEDRIVER_PATH";

export const ENV_PATH: Record<ManagedBrowser, string> = {
  firefox: "SAMURAI_FIREFOX_PATH",
  chrome: "SAMURAI_CHROME_PATH",
};

/** The env variable, else the config's `browserPaths`; undefined: use the managed build */
export function overrideOf(
  name: ManagedBrowser,
  {
    env = process.env,
    browserPaths,
    projectDir = process.cwd(),
  }: OverrideSources = {},
): Override | undefined {
  const fromEnv = env[ENV_PATH[name]];
  if (fromEnv) return { path: path.resolve(fromEnv), from: "env" };
  const fromConfig = browserPaths?.[name];
  if (fromConfig)
    return { path: path.resolve(projectDir, fromConfig), from: "config" };
  return undefined;
}
