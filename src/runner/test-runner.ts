import { glob } from "node:fs/promises";
import path from "path";
import { ensureWarm } from "../browser/warm-up.js";
import { projectBrowser } from "../browsers/resolve.js";
import { projectDir, readConfig } from "../config/config.js";
import logger from "../logger/index.js";
import type { RegisteredTestCase } from "../types/test.js";
import { DEFAULT_SRC_DIR, DEFAULT_TEST_MATCH } from "./groups.js";
import type { ResolvedGroup } from "./groups.js";
import type { RunnerOptions } from "./options.js";
import { DEFAULT_PORT } from "./ports.js";
import type { PreparedRun } from "./prepare-run.js";
import TestReporter from "./reporter.js";
import { runOneTest } from "./run-test.js";
import { browsersOfRun, loadSpecs, selectTests } from "./select.js";

export type { RunnerOptions } from "./options.js";

/** Finds the spec files, picks the tests and browsers of a run and runs each test in each browser */
export default class TestRunner {
  private testFiles: string[];
  private run: PreparedRun;
  private options: RunnerOptions;

  constructor(
    testFiles: string[],
    run: PreparedRun,
    options: RunnerOptions = {},
  ) {
    this.testFiles = testFiles;
    this.run = run;
    this.options = options;
  }

  static async init(run: PreparedRun, options: RunnerOptions = {}) {
    logger.verbose("Initializing test runner");
    const srcDir = (await readConfig("srcDir")) ?? DEFAULT_SRC_DIR;

    const cwd = path.resolve(projectDir(), srcDir);
    if (options.files) {
      return new TestRunner(
        options.files.map((file) => path.resolve(projectDir(), file)),
        run,
        options,
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
    );
  }

  /** The groups of the config with the tests each holds; see `listGroups` */
  public async groups(): Promise<ResolvedGroup[]> {
    return (await loadSpecs(this.testFiles)).groups;
  }

  /** Imports the spec files and returns the tests the options select: by `group`, `testNames` and `grep` */
  public async register(): Promise<RegisteredTestCase[]> {
    return selectTests(await loadSpecs(this.testFiles), this.options);
  }

  /** Runs the selected tests in every browser of the run, one browser after the other, and returns the summary that was also written to the report */
  public async start() {
    const { reportPath, onEvent, signal } = this.options;
    // The specs are imported once: their top-level code runs once per run
    const loaded = await loadSpecs(this.testFiles);
    const selected = selectTests(loaded, this.options);
    const browsers = await browsersOfRun(loaded.groups, this.options);
    const reporter = new TestReporter({
      environment: this.run.settings.environment,
      browsers,
      ...(reportPath !== undefined && { output: reportPath }),
      ...(onEvent && { onEvent }),
    });

    // A missing browser is one clear error before the run, not a failure per test, and before any browser has run a
    // test; a fresh build's slow first start happens here too, outside any test's timeout
    if (selected.length > 0) {
      for (const browser of browsers) await projectBrowser(browser);
      for (const browser of browsers)
        await ensureWarm(
          browser,
          { port: this.options.port ?? DEFAULT_PORT },
          signal,
        );
    }
    reporter.onStart(selected.length * browsers.length);
    for (const browser of browsers) {
      for (const test of selected) {
        if (signal?.aborted) {
          reporter.onTestStart(test, browser);
          reporter.onTestEnd(test, browser, {
            message: "Run aborted",
            type: "error",
          });
          continue;
        }
        await runOneTest(
          test,
          browser,
          this.run,
          this.options,
          loaded.srcDir,
          reporter,
        );
      }
    }
    return reporter.onEnd();
  }
}
