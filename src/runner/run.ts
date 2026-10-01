import { loadConfig, projectDir, setActiveProject } from "../config/config.js";
import { resetSecrets } from "../config/mask.js";
import { setRunSettings, type RunOverrides } from "../config/run-settings.js";
import type { SamuraiTestConfig } from "../types/config.js";
import type { TestSummary } from "../types/test.js";
import { prepareRun } from "./prepare-run.js";
import TestRunner, { type RunnerOptions } from "./test-runner.js";

export interface RunTestsOptions extends RunnerOptions, RunOverrides {
  /** The project to run: its `samurai.config.ts`, `.env.<environment>`, specs and report. @default the working directory */
  projectDir?: string;
  /** Use this config instead of reading `samurai.config.ts` */
  config?: SamuraiTestConfig;
  /** Where the framework keeps browser profiles. @default `SAMURAI_DATA_DIR`, else `browsers/` in the project folder */
  dataDir?: string;
}

let running = false;

/**
 * Runs the project's tests, one after the other, and resolves with the summary (also written to the report).
 * Spec files are TypeScript: the process must be able to import them (run under `tsx`, or with Node's own
 * type stripping). One run at a time per process: config, secrets and the test registry are shared state;
 * use a child process per run for more.
 * @example
 *  const summary = await runTests({ projectDir: "/work/shop", environment: "staging", headless: true,
 *    onEvent: (event) => console.log(event.type) });
 */
export async function runTests(
  options: RunTestsOptions = {},
): Promise<TestSummary> {
  return inProject(options, (runner) => runner.start());
}

/** A test found in a spec file */
export interface FoundTest {
  /** Full name: `describe` titles and the test title joined with " > " */
  name: string;
  file: string;
}

/** Imports the project's specs without running anything and lists the tests the options select */
export async function listTests(
  options: RunTestsOptions = {},
): Promise<FoundTest[]> {
  return inProject(options, async (runner) =>
    (await runner.register()).map(({ name, file }) => ({ name, file })),
  );
}

/** Runs `work` with the project active (config, folders), one run or listing at a time per process */
async function inProject<T>(
  options: RunTestsOptions,
  work: (runner: TestRunner) => Promise<T>,
): Promise<T> {
  if (running) throw new Error("A test run is already active in this process");
  running = true;
  const {
    projectDir: dir,
    config,
    dataDir,
    environment,
    timeout,
    expectTimeout,
    ...runner
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
    });
    return await work(await TestRunner.init(run, undefined, runner));
  } finally {
    setRunSettings(undefined);
    setActiveProject(undefined);
    running = false;
  }
}

export type { RunEvent } from "./reporter.js";
export type { RunnerOptions } from "./test-runner.js";
