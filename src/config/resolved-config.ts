import path from "node:path";
import type { SupportedBrowser } from "../types/browser.js";
import type { SamuraiGroup, SamuraiTestConfig } from "../types/config.js";
import { browsersFor } from "./browsers-for.js";
import { projectConfig, validateConfig } from "./config.js";
import {
  DEFAULT_COLLECT_BODIES,
  DEFAULT_COMMAND_TIMEOUT,
  DEFAULT_DOWNLOADS_DIR,
  DEFAULT_FAIL_ON_PAGE_ERROR,
  DEFAULT_FILES_DIR,
  DEFAULT_IDLE_TIME,
  DEFAULT_LOGS_CAPTURE,
  DEFAULT_MAX_BODY_SIZE,
  DEFAULT_NAVIGATION_TIMEOUT,
  DEFAULT_RETRIES,
  DEFAULT_ROUTE_TIMEOUT,
  DEFAULT_SRC_DIR,
  DEFAULT_TRACK_NETWORK,
  DEFAULT_VIEWPORT,
  DEFAULT_WAIT_UNTIL,
} from "./defaults.js";
import { forbidsOnly } from "./forbid-only.js";
import {
  IMPLICIT_ENVIRONMENT,
  resolveRunSettings,
  UnknownEnvironmentError,
  type Variables,
} from "./run-settings.js";
import { resolveWorkers } from "./workers-option.js";

/** Where the environment variables come from: `CI` and the like */
type Env = Record<string, string | undefined>;

/** One environment with the project's values and the built-in defaults merged in, as a run without overrides uses it */
export interface ResolvedEnvironment {
  baseURL?: string;
  /** Time (ms) one test may take */
  timeout: number;
  /** Time (ms) actions and assertions retry */
  expectTimeout: number;
  /** Whether the browser runs without a window */
  headless: boolean;
  variables: Variables;
}

/** An entry of `logs.ignoreErrors` as data: a `RegExp` keeps its source and flags */
export interface ResolvedIgnoreError {
  text: string;
  regexp: boolean;
  flags?: string;
}

/**
 * A project's config with every default applied and the run-level precedence resolved: what a run without command
 * line flags uses. Plain JSON data, so it survives `process.send`.
 */
export interface ResolvedConfig {
  /** The project folder, absolute */
  projectDir: string;
  /** The test folder, absolute and not resolved through symlinks: use `FoundTest.relativeFile` rather than computing paths against it */
  srcDir: string;
  /** The test folder as the config writes it */
  srcDirRelative: string;
  browsers: SupportedBrowser[];
  browserPaths: { firefox?: string; chrome?: string };
  timeout: number;
  expectTimeout: number;
  navigationTimeout: number;
  waitUntil: "none" | "interactive" | "complete";
  bidiCommandTimeout: number;
  /** The config's `workers` as written */
  workers?: number | string;
  /** The workers a run without `--workers` and `SAMURAI_WORKERS` uses on this machine */
  workersResolved: number;
  retries: number;
  forbidOnly: boolean;
  headless: boolean;
  /** `null` keeps the browser's own size */
  viewport: { width: number; height: number } | null;
  downloadsDir: string;
  filesDir: string;
  logs: {
    capture: "off" | "failures" | "all";
    failOnPageError: boolean;
    ignoreErrors: ResolvedIgnoreError[];
  };
  network: {
    track: boolean;
    idleTime: number;
    routeTimeout: number;
    collectBodies: boolean;
    maxBodySize: number;
  };
  /** The project's `baseURL` */
  baseURL?: string;
  /** The config's `defaultEnvironment` as written */
  defaultEnvironment?: string;
  /** Why a run without `--env` would stop: no environment chosen, or an unknown `defaultEnvironment` */
  environmentProblem?: string;
  /** Every environment by name; a config without `environments` has one, `"default"` */
  environments: Record<string, ResolvedEnvironment>;
  /** The groups as written, each with the browsers it runs in */
  groups: (SamuraiGroup & { browsers: SupportedBrowser[] })[];
  /** The kinds of the project's own flow steps */
  steps: string[];
}

/** The message a run without `--env` throws for this config, if any */
function environmentProblem(
  config: SamuraiTestConfig,
  env: Env,
): string | undefined {
  try {
    resolveRunSettings(config, {}, env);
    return undefined;
  } catch (error) {
    if (error instanceof UnknownEnvironmentError) return error.message;
    throw error;
  }
}

/** Every environment of the config merged the way `resolveRunSettings` merges it */
function resolveEnvironments(
  config: SamuraiTestConfig,
  env: Env,
): Record<string, ResolvedEnvironment> {
  const names = Object.keys(config.environments ?? {});
  return Object.fromEntries(
    (names.length > 0 ? names : [IMPLICIT_ENVIRONMENT]).map((name) => {
      const { environment, ...settings } = resolveRunSettings(
        config,
        { environment: name },
        env,
      );
      return [environment, settings];
    }),
  );
}

/** `logs.ignoreErrors` as JSON-safe data */
function ignoreErrorsOf(
  list: readonly (string | RegExp)[] = [],
): ResolvedIgnoreError[] {
  return list.map((entry) =>
    typeof entry === "string"
      ? { text: entry, regexp: false }
      : {
          text: entry.source,
          regexp: true,
          ...(entry.flags !== "" && { flags: entry.flags }),
        },
  );
}

/**
 * The config with every default applied, from the same constants and functions a run uses. Throws the errors a run
 * throws for a bad config; an environment a run could not choose is reported in `environmentProblem` instead.
 * Pure: reads no files.
 */
export function resolveConfig(
  config: SamuraiTestConfig,
  options: { projectDir: string; env: Env },
): ResolvedConfig {
  validateConfig(config);
  const { env } = options;
  const projectDir = path.resolve(options.projectDir);
  const srcDirRelative = config.srcDir ?? DEFAULT_SRC_DIR;
  // The project level: the same precedence without an environment
  const project = resolveRunSettings(
    { ...config, environments: undefined, defaultEnvironment: undefined },
    {},
    env,
  );
  const problem = environmentProblem(config, env);
  const viewport = config.use?.viewport;
  return {
    projectDir,
    srcDir: path.resolve(projectDir, srcDirRelative),
    srcDirRelative,
    browsers: browsersFor({ project: config.browsers }),
    browserPaths: { ...config.browserPaths },
    timeout: project.timeout,
    expectTimeout: project.expectTimeout,
    navigationTimeout: config.navigation?.timeout ?? DEFAULT_NAVIGATION_TIMEOUT,
    waitUntil: config.navigation?.waitUntil ?? DEFAULT_WAIT_UNTIL,
    bidiCommandTimeout: config.bidi?.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT,
    ...(config.workers !== undefined && { workers: config.workers }),
    workersResolved: resolveWorkers({ config: config.workers }),
    // Matches the runner's `resolveRetries` without the command line flag and the environment (config/ cannot import runner/)
    retries: config.retries ?? DEFAULT_RETRIES,
    forbidOnly: forbidsOnly(config, env),
    headless: project.headless,
    viewport: viewport === null ? null : { ...(viewport ?? DEFAULT_VIEWPORT) },
    downloadsDir: config.downloadsDir ?? DEFAULT_DOWNLOADS_DIR,
    filesDir: config.filesDir ?? DEFAULT_FILES_DIR,
    logs: {
      capture: config.logs?.capture ?? DEFAULT_LOGS_CAPTURE,
      failOnPageError:
        config.logs?.failOnPageError ?? DEFAULT_FAIL_ON_PAGE_ERROR,
      ignoreErrors: ignoreErrorsOf(config.logs?.ignoreErrors),
    },
    network: {
      track: config.network?.track ?? DEFAULT_TRACK_NETWORK,
      idleTime: config.network?.idleTime ?? DEFAULT_IDLE_TIME,
      routeTimeout: config.network?.routeTimeout ?? DEFAULT_ROUTE_TIMEOUT,
      collectBodies: config.network?.collectBodies ?? DEFAULT_COLLECT_BODIES,
      maxBodySize: config.network?.maxBodySize ?? DEFAULT_MAX_BODY_SIZE,
    },
    ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
    ...(config.defaultEnvironment !== undefined && {
      defaultEnvironment: config.defaultEnvironment,
    }),
    ...(problem !== undefined && { environmentProblem: problem }),
    environments: resolveEnvironments(config, env),
    groups: (config.groups ?? []).map((group) => ({
      ...group,
      browsers: browsersFor({
        group: group.browsers,
        project: config.browsers,
      }),
    })),
    steps: (config.steps ?? []).map((step) => step.kind),
  };
}

/**
 * A project's `samurai.config.ts` with every default applied, the way a run uses it (see {@link ResolvedConfig}).
 * Leaves no project active. The caller registers `tsx` first (the framework does not), so the config file can be
 * imported; an app does that in the child process that calls this. The config module is imported once per process
 * (Node caches it): a later edit to `samurai.config.ts` is seen only in a new process.
 * @param options.projectDir The project folder. @default the working directory
 * @param options.env Where `CI` is read from. @default `process.env`
 */
export async function loadConfig(
  options: { projectDir?: string; env?: Env } = {},
): Promise<ResolvedConfig> {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const config = await projectConfig({ projectDir });
  return resolveConfig(config, { projectDir, env: options.env ?? process.env });
}
