import type { TestSummary } from "../types/test.js";
import { withProject, type ProjectOptions } from "./project.js";
import type { ResolvedGroup } from "./groups.js";
import TestRunner, { type RunnerOptions } from "./test-runner.js";

export interface RunTestsOptions extends RunnerOptions, ProjectOptions {}

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
    {
      projectDir,
      config,
      dataDir,
      environment,
      timeout,
      expectTimeout,
    } as ProjectOptions,
    async (run) => (await TestRunner.init(run, undefined, runner)).start(),
  );
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
    {
      projectDir,
      config,
      dataDir,
      environment,
      timeout,
      expectTimeout,
    } as ProjectOptions,
    async (run) =>
      (await (await TestRunner.init(run, undefined, runner)).register()).map(
        ({ name, file }) => ({ name, file }),
      ),
  );
}

/** Imports the project's specs without running anything and lists the config's groups with the tests each holds */
export async function listGroups(
  options: RunTestsOptions = {},
): Promise<ResolvedGroup[]> {
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
    {
      projectDir,
      config,
      dataDir,
      environment,
      timeout,
      expectTimeout,
    } as ProjectOptions,
    async (run) => (await TestRunner.init(run, undefined, runner)).groups(),
  );
}

export type { RunEvent } from "./reporter.js";
export type { TestError, TestResult, TestSummary } from "../types/test.js";
export type { ResolvedGroup } from "./groups.js";
export type { RunnerOptions } from "./test-runner.js";
export type { ProjectOptions } from "./project.js";
