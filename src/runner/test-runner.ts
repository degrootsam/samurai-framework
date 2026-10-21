import { glob } from "node:fs/promises";
import path from "path";
import { ensureWarm } from "../browser/warm-up.js";
import { projectBrowser } from "../browsers/resolve.js";
import { loadConfig, projectDir, readConfig } from "../config/config.js";
import { forbidsOnly } from "../config/forbid-only.js";
import logger from "../logger/index.js";
import type { RegisteredTestCase } from "../types/test.js";
import { AllHooks } from "./all-hooks.js";
import { assertNoOnly, narrowToOnly } from "./focus.js";
import { DEFAULT_SRC_DIR, DEFAULT_TEST_MATCH } from "../config/defaults.js";
import type { ResolvedGroup } from "./groups.js";
import type { RunnerOptions } from "./options.js";
import { DEFAULT_PORT } from "./ports.js";
import type { PreparedRun } from "./prepare-run.js";
import TestReporter from "./reporter.js";
import {
  concurrency,
  planItems,
  poolMode,
  runPooled,
  serialKeyOf,
  type PooledRunner,
} from "./pooled-run.js";
import { allHookFixtures, runOneTest } from "./run-test.js";
import { staticSkip } from "./skip.js";
import { browsersOfRun, loadSpecs, selectTests } from "./select.js";
import { resolveRetries } from "./retries-option.js";
import { runWithRetries } from "./retry.js";
import { resolveWorkers } from "./workers-option.js";
import { WorkerPool, type PoolOptions } from "./worker-pool.js";
import { processWorkerFactory } from "./worker-process.js";

export type { RunnerOptions } from "./options.js";

/** What a runner knows about the project it runs in, besides the options of the run */
export interface ProjectInfo {
  /** The config was given as an object, not read from `samurai.config.ts`: a worker process cannot get it */
  inlineConfig?: boolean;
  /** Where the framework keeps browser profiles; a worker needs the same folder */
  dataDir?: string;
  /** Makes the pool of a run with more than one worker; tests give a fake */
  createPool?: (
    options: PoolOptions,
  ) => PooledRunner & { dispose(): Promise<void> };
}

/** Finds the spec files, picks the tests and browsers of a run and runs each test in each browser */
export default class TestRunner {
  private testFiles: string[];
  private run: PreparedRun;
  private options: RunnerOptions;
  private project: ProjectInfo;

  constructor(
    testFiles: string[],
    run: PreparedRun,
    options: RunnerOptions = {},
    project: ProjectInfo = {},
  ) {
    this.testFiles = testFiles;
    this.run = run;
    this.options = options;
    this.project = project;
  }

  static async init(
    run: PreparedRun,
    options: RunnerOptions = {},
    project: ProjectInfo = {},
  ) {
    logger.verbose("Initializing test runner");
    const srcDir = (await readConfig("srcDir")) ?? DEFAULT_SRC_DIR;

    const cwd = path.resolve(projectDir(), srcDir);
    if (options.files) {
      return new TestRunner(
        options.files.map((file) => path.resolve(projectDir(), file)),
        run,
        options,
        project,
      );
    }
    logger.verbose("Reading test files from: %s", cwd);
    const testFiles: string[] = [];
    for await (const entry of glob(DEFAULT_TEST_MATCH, {
      cwd,
    })) {
      testFiles.push(entry);
    }
    logger.debug("Found %d tests in srcDir", testFiles.length);
    return new TestRunner(
      testFiles.map((file) => path.join(cwd, file)),
      run,
      options,
      project,
    );
  }

  /** The groups of the config with the tests each holds; see `listGroups` */
  public async groups(): Promise<ResolvedGroup[]> {
    return (await loadSpecs(this.testFiles)).groups;
  }

  /**
   * Imports the spec files and returns the tests the options select (by `group`, `testNames` and `grep`)
   * with the real `srcDir` their ids are relative to
   */
  public async list(): Promise<{
    tests: RegisteredTestCase[];
    srcDir: string;
  }> {
    const loaded = await loadSpecs(this.testFiles);
    return { tests: selectTests(loaded, this.options), srcDir: loaded.srcDir };
  }

  /**
   * Runs the selected tests in every browser of the run, one browser after the other, and returns the summary that
   * was also written to the report. With more than one worker the tests run at the same time in worker processes.
   */
  public async start() {
    const { reportPath, onEvent, signal } = this.options;
    // The specs are imported once: their top-level code runs once per run
    const loaded = await loadSpecs(this.testFiles);
    const config = await loadConfig();
    // A focused test the config refuses stops the run before anything starts; else only the focused ones run
    assertNoOnly(loaded.all, forbidsOnly(config), loaded.srcDir);
    const selected = narrowToOnly(selectTests(loaded, this.options));
    const browsers = await browsersOfRun(loaded.groups, this.options);
    const reporter = new TestReporter({
      environment: this.run.settings.environment,
      browsers,
      ...(reportPath !== undefined && { output: reportPath }),
      ...(onEvent && { onEvent }),
    });

    // How the run goes is settled first: a bad `workers` is an error before any browser starts
    const requested = resolveWorkers({
      flag: this.options.workers,
      env: process.env.SAMURAI_WORKERS,
      config: config.workers,
    });
    // A bad `retries` is an error here too, before any browser starts
    const retries = resolveRetries({
      flag: this.options.retries,
      env: process.env.SAMURAI_RETRIES,
      config: config.retries,
    });
    const plan = planItems(
      selected,
      browsers,
      serialKeyOf(loaded.groups, config.groups, loaded.srcDir),
    );
    // A pool larger than what can overlap would only hold idle workers: a group that runs one at a time needs one
    const lanes = concurrency(plan.items);
    const mode = poolMode({
      workers: requested,
      items: lanes,
      inlineConfig: this.project.inlineConfig ?? false,
    });
    if (mode === "inline-config" && this.workersAsked(config.workers))
      logger.warn(
        "workers needs samurai.config.ts in the project folder; running on one worker",
      );

    // A missing browser is one clear error before the run, not a failure per test, and before any browser has run a
    // test; a fresh build's slow first start happens here too, outside any test's timeout
    // Skipped tests need no browser, so a run of only those needs none installed
    if (selected.some((test) => !staticSkip(test))) {
      for (const browser of browsers) await projectBrowser(browser);
      for (const browser of browsers)
        await ensureWarm(
          browser,
          { port: this.options.port ?? DEFAULT_PORT },
          signal,
        );
    }

    if (mode === "pool") {
      const workers = Math.min(requested, lanes);
      reporter.onStart(plan.planned.length, workers);
      const pool = this.createPool(workers, retries);
      try {
        await runPooled(pool, plan.planned, plan.items, reporter, signal);
      } finally {
        await pool.dispose();
      }
      return reporter.onEnd();
    }

    reporter.onStart(selected.length * browsers.length);
    // The `afterAll` hooks run when the last test is done, before the run ends
    const allHooks = new AllHooks({
      timeout: this.run.settings.timeout,
      fixtures: (browser) => allHookFixtures(this.run, browser),
    });
    try {
      for (const browser of browsers) {
        for (const test of selected) {
          const skip = staticSkip(test);
          if (skip) {
            reporter.onTestSkipped(test, browser, skip);
            continue;
          }
          if (signal?.aborted) {
            reporter.onTestStart(test, browser);
            reporter.onTestEnd(test, browser, {
              message: "Run aborted",
              type: "error",
            });
            continue;
          }
          await runWithRetries(
            test,
            browser,
            retries,
            signal,
            (sink, attempt) =>
              runOneTest(
                test,
                browser,
                this.run,
                this.options,
                loaded.srcDir,
                sink,
                { allHooks, attempt },
              ),
            reporter,
          );
        }
      }
    } finally {
      for (const error of await allHooks.closeAll())
        logger.error("%s", error.message);
    }
    return reporter.onEnd();
  }

  /** Whether anything but the default says how many workers to use */
  private workersAsked(fromConfig: unknown): boolean {
    return (
      this.options.workers !== undefined ||
      Boolean(process.env.SAMURAI_WORKERS?.trim()) ||
      fromConfig !== undefined
    );
  }

  /** The pool of a run: up to `workers` worker processes that read the same project and settings as this run */
  private createPool(workers: number, retries: number) {
    const { settings } = this.run;
    const { reportPath, headless, port } = this.options;
    const options: PoolOptions = {
      workers,
      factory: processWorkerFactory(),
      init: {
        projectDir: projectDir(),
        ...(this.project.dataDir !== undefined && {
          dataDir: this.project.dataDir,
        }),
        environment: settings.environment,
        timeout: settings.timeout,
        expectTimeout: settings.expectTimeout,
        ...(headless !== undefined && { headless }),
        ...(typeof reportPath === "string" && { reportPath }),
        files: this.testFiles,
        basePort: port ?? DEFAULT_PORT,
        ...(retries > 0 && { retries }),
      },
    };
    return (this.project.createPool ?? ((o) => new WorkerPool(o)))(options);
  }
}
