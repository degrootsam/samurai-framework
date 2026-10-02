import { loadConfig, projectDir, setActiveProject } from "../config/config.js";
import { resetSecrets } from "../config/mask.js";
import { setRunSettings, type RunOverrides } from "../config/run-settings.js";
import type { SamuraiTestConfig } from "../types/config.js";
import { prepareRun, type PreparedRun } from "./prepare-run.js";

/** Which project an operation works on, and in which environment */
export interface ProjectOptions extends RunOverrides {
  /** The project folder: `samurai.config.ts`, `.env.<environment>`, specs and `result/`. @default the working directory */
  projectDir?: string;
  /** Use this config instead of reading `samurai.config.ts` */
  config?: SamuraiTestConfig;
  /** Where the framework keeps browser profiles. @default `SAMURAI_DATA_DIR`, else `browsers/` in the project folder */
  dataDir?: string;
}

let active = false;

/**
 * Runs `work` with the project's config, folders, environment and secrets in place, and cleans up afterwards.
 * One at a time per process: these are process-wide, so a second call throws.
 */
export async function withProject<T>(
  options: ProjectOptions,
  work: (run: PreparedRun) => Promise<T>,
): Promise<T> {
  if (active) throw new Error("A test run is already active in this process");
  active = true;
  const {
    projectDir: dir,
    config,
    dataDir,
    environment,
    timeout,
    expectTimeout,
    headless,
  } = options;
  const previousDir = projectDir();
  try {
    setActiveProject({ dir: dir ?? previousDir, config, dataDir });
    const loaded = config ?? (await loadConfig());
    setActiveProject({ dir: dir ?? previousDir, config: loaded, dataDir });
    resetSecrets();
    const run = prepareRun(loaded, {
      ...(environment !== undefined && { environment }),
      ...(timeout !== undefined && { timeout }),
      ...(expectTimeout !== undefined && { expectTimeout }),
      ...(headless !== undefined && { headless }),
    });
    return await work(run);
  } finally {
    setRunSettings(undefined);
    setActiveProject(undefined);
    active = false;
  }
}
