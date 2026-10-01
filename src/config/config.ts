import type { SamuraiTestConfig } from "../types/config.js";
import path from "path";
import logger from "../logger/index.js";
import { pathToFileURL } from "url";

/** The project a run belongs to; without one, everything is relative to the working directory */
interface ActiveProject {
  dir: string;
  /** Used instead of reading `samurai.config.ts` */
  config?: SamuraiTestConfig | undefined;
  /** Where the framework keeps browser profiles; see `browsersDir` */
  dataDir?: string | undefined;
}

let activeProject: ActiveProject | undefined;

/** Makes `project` the one config, secrets, reports and downloads are resolved for; `undefined` ends it */
export function setActiveProject(project: ActiveProject | undefined): void {
  activeProject = project && { ...project, dir: path.resolve(project.dir) };
}

/** The folder of the project being run: the active project's, else the working directory */
export function projectDir(): string {
  return activeProject?.dir ?? process.cwd();
}

/**
 * Where the framework keeps what it generates for browsers (profile preferences, Firefox app data):
 * `SAMURAI_DATA_DIR`, else the active project's `dataDir`, else `browsers/` in the project folder.
 * An embedding app points it at a folder it may write to.
 */
export function browsersDir(): string {
  return path.resolve(
    process.env.SAMURAI_DATA_DIR ??
      activeProject?.dataDir ??
      path.join(projectDir(), "browsers"),
  );
}

/** The whole `samurai.config.ts` of the project (the working directory unless a project is active) */
export async function loadConfig(): Promise<SamuraiTestConfig> {
  if (activeProject?.config) return activeProject.config;
  const configUrl = path.join(projectDir(), "samurai.config.ts");
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
