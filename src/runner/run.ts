import type { Modifier, TestSummary } from "../types/test.js";
import type { PreparedRun } from "./prepare-run.js";
import { withProject, type ProjectOptions } from "./project.js";
import type { ResolvedGroup } from "./groups.js";
import TestRunner from "./test-runner.js";
import type { RunnerOptions } from "./options.js";

export interface RunTestsOptions extends RunnerOptions, ProjectOptions {}

/**
 * Sets the project up (config, environment, secrets), builds a runner from the rest of the options and hands both to
 * `work`. `headless` stays with the runner options on purpose: the runner reads it, and the project's run settings
 * (`withProject`'s own `headless`) are left to the config.
 */
function inProject<T>(
  options: RunTestsOptions,
  work: (runner: TestRunner) => Promise<T>,
): Promise<T> {
  const {
    projectDir,
    config,
    dataDir,
    environment,
    timeout,
    expectTimeout,
    ...runner
  } = options;
  return withProject(
    // The cast is for `exactOptionalPropertyTypes`: these may be undefined, which the project options leave out
    {
      projectDir,
      config,
      dataDir,
      environment,
      timeout,
      expectTimeout,
    } as ProjectOptions,
    async (run: PreparedRun) =>
      work(
        await TestRunner.init(run, runner, {
          inlineConfig: config !== undefined,
          ...(dataDir !== undefined && { dataDir }),
        }),
      ),
  );
}

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
  /** `skip` or `fixme` (not run), or `only` (focused); absent for a plain test. A modifier on a `describe` counts. */
  modifier?: Modifier;
}

/** Imports the project's specs without running anything and lists the tests the options select */
export async function listTests(
  options: RunTestsOptions = {},
): Promise<FoundTest[]> {
  return inProject(options, async (runner) =>
    (await runner.register()).map(({ name, file, modifier }) => ({
      name,
      file,
      ...(modifier && { modifier }),
    })),
  );
}

/** Imports the project's specs without running anything and lists the config's groups with the tests each holds */
export async function listGroups(
  options: RunTestsOptions = {},
): Promise<ResolvedGroup[]> {
  return inProject(options, (runner) => runner.groups());
}

export { BROWSER_NAMES, checkBrowserList } from "../config/browsers.js";
export { parseWorkers } from "../config/workers.js";
export { parseRetries } from "../config/retries.js";
export type { RunEvent } from "./reporter.js";
export type {
  Modifier,
  TestError,
  TestResult,
  TestSummary,
} from "../types/test.js";
export type { ResolvedGroup } from "./groups.js";
export type { RunnerOptions } from "./options.js";
export type { ProjectOptions } from "./project.js";
export { DEFAULT_PORT } from "./ports.js";
