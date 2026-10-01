import assert from "assert";
import { glob } from "node:fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { Browser } from "../browser/browser.js";
import { projectDir, readConfig } from "../config/config.js";
import logger from "../logger/index.js";
import type { SupportedBrowser } from "../types/browser.js";
import type { RegisteredTestCase, TestFixtures } from "../types/test.js";
import { assertModuleProject } from "./module-type.js";
import { clearRegistry, registeredTests } from "./registry.js";
import type { PreparedRun } from "./prepare-run.js";
import { createEnvFixture } from "../config/variables.js";
import { createSecretsFixture } from "../config/secrets.js";
import TestReporter, { type RunEvent } from "./reporter.js";
import type { SamuraiGroup } from "../types/config.js";
import Page from "../browser/page.js";
import { takePendingAssertions } from "../assert/expect.js";
import { toTestError } from "./test-error.js";
import { judgePageLogs } from "./page-logs-report.js";
import type { LogsConfig } from "./page-logs-report.js";

/** What decides which tests of the found files run, and how the browser starts */
export interface RunnerOptions {
  /** Spec files to run, absolute or relative to the project folder. Default: every `*.spec.ts` under `srcDir` */
  files?: string[];
  /** Only tests whose full name matches (a string must be contained in it) */
  grep?: string | RegExp;
  /** Only tests with exactly one of these full names (`describe` titles joined with " > ") */
  testNames?: string[];
  /** Run the browser without a window. @default false */
  headless?: boolean;
  /** Remote debugging port of the browser. @default 9223 */
  port?: number;
  /** Where the report is written; `false` writes none. @default `<project>/result/report.json` */
  reportPath?: string | false;
  /** Receives start and end of the run and of every test, as they happen */
  onEvent?: (event: RunEvent) => void;
  /** Aborting stops the running test (its browser is closed), skips the rest and reports the run as failed */
  signal?: AbortSignal;
}

/** Whether a test with this full name is selected by the options */
export function isSelected(
  name: string,
  { grep, testNames }: Pick<RunnerOptions, "grep" | "testNames">,
): boolean {
  if (testNames && !testNames.includes(name)) return false;
  if (grep === undefined) return true;
  if (typeof grep === "string") return name.includes(grep);
  grep.lastIndex = 0;
  return grep.test(name);
}

export default class TestRunner {
  private testFiles: string[];
  private run: PreparedRun;
  private group?: SamuraiGroup;
  private options: RunnerOptions;

  constructor(
    testFiles: string[],
    run: PreparedRun,
    group?: SamuraiGroup,
    options: RunnerOptions = {},
  ) {
    this.testFiles = testFiles;
    this.run = run;
    this.group = group;
    this.options = options;
  }

  static async init(
    run: PreparedRun,
    group?: SamuraiGroup,
    options: RunnerOptions = {},
  ) {
    logger.verbose("Initializing test runner");
    let srcDir = "";

    if (group && group.src) {
      srcDir = group.src;
    } else {
      srcDir = (await readConfig("srcDir")) ?? "./src";
    }

    assert(srcDir, "No srcDir declared!");

    const cwd = path.resolve(projectDir(), srcDir);
    if (options.files) {
      return new TestRunner(
        options.files.map((file) => path.resolve(projectDir(), file)),
        run,
        group,
        options,
      );
    }
    logger.verbose("Reading test files from: %s", cwd);
    const testFiles: string[] = [];
    for await (const entry of glob("**/*.spec.ts", {
      cwd,
    })) {
      testFiles.push(entry);
    }
    logger.debug("Found %d tests in srcDir", testFiles.length);
    return new TestRunner(
      testFiles.map((file) => path.join(cwd, file)),
      run,
      group,
      options,
    );
  }

  /** Runs the selected tests and returns the summary that was also written to the report */
  public async start() {
    const { reportPath, onEvent, signal } = this.options;
    const reporter = new TestReporter({
      environment: this.run.settings.environment,
      ...(reportPath !== undefined && { output: reportPath }),
      ...(onEvent && { onEvent }),
    });

    // A fresh registry, and a fresh import of each file so a second run in this process registers its tests again
    // (and sees edited specs, for files loaded as ES modules; CommonJS files stay cached until the process ends)
    clearRegistry();
    const stamp = `?run=${Date.now().toString(36)}`;
    for (const file of this.testFiles) assertModuleProject(file);
    for (const file of this.testFiles) {
      logger.verbose("Trying to register file: %s", file);
      await import(pathToFileURL(file).href + stamp);
    }

    logger.verbose("Running test files");

    // TODO: Implement test grouping
    const selected = registeredTests().filter((test) =>
      isSelected(test.name, this.options),
    );
    reporter.onStart(selected.length);
    for (const test of selected) {
      if (signal?.aborted) {
        reporter.onTestStart(test);
        reporter.onTestEnd(test, { message: "Run aborted", type: "error" });
        continue;
      }
      await this.executeTestCase(test, reporter);
    }
    return reporter.onEnd();
  }

  private async executeTestCase(
    test: RegisteredTestCase,
    reporter: TestReporter,
  ) {
    logger.verbose("Starting test: %s", test.name);
    reporter.onTestStart(test);
    const selectedBrowser: SupportedBrowser =
      (await readConfig("browser")) ?? "firefox";
    const { settings, secrets } = this.run;
    const timeout = settings.timeout;

    let browser: Browser | undefined;
    let page: Page | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let onRunAborted: (() => void) | undefined;
    const timeoutController = new AbortController();

    await Promise.race([
      new Promise<void>((resolve) => {
        timeoutTimer = setTimeout(() => {
          reporter.onTestEnd(test, {
            message: `Test timed out after ${timeout / 1000} seconds`,
            type: "timeout",
          });
          timeoutController.abort(new Error("Test timed out"));
          resolve();
        }, timeout);
        onRunAborted = () => {
          if (timeoutController.signal.aborted) return;
          reporter.onTestEnd(test, { message: "Run aborted", type: "error" });
          timeoutController.abort(new Error("Run aborted"));
          resolve();
        };
        this.options.signal?.addEventListener("abort", onRunAborted, {
          once: true,
        });
      }),
      new Promise<void>(async (resolve, reject) => {
        try {
          const launched = await Browser.launch(
            selectedBrowser,
            {
              port: this.options.port ?? 9223,
              headless: this.options.headless ?? false,
            },
            timeoutController.signal,
          );
          browser = launched.browser;
          page = launched.page;
          const fixtures: TestFixtures = {
            page: launched.page,
            browser: launched.browser,
            env: createEnvFixture(settings.environment, settings.variables),
            secrets: createSecretsFixture(settings.environment, secrets),
          };
          await test.function(fixtures);
          // Already reported as timed out
          if (timeoutController.signal.aborted) return resolve();
          const unawaited = takePendingAssertions();
          if (unawaited.length > 0) {
            reporter.onTestEnd(
              test,
              {
                message: unawaited
                  .map(
                    (matcher) => `expect(locator).${matcher}() was not awaited`,
                  )
                  .join("\n"),
                type: "assertion",
              },
              await judgeLogs(page, true),
            );
            return resolve();
          }
          const verdict = await judgeLogs(page, false);
          reporter.onTestEnd(test, verdict.error, verdict);
          resolve();
        } catch (err) {
          if (timeoutController.signal.aborted) return resolve();
          reporter.onTestEnd(
            test,
            toTestError(err),
            await judgeLogs(page, true),
          );
          resolve();
        }
      }),
    ]);

    clearTimeout(timeoutTimer);
    if (onRunAborted)
      this.options.signal?.removeEventListener("abort", onRunAborted);
    takePendingAssertions();
    logger.verbose("Closing browser for test: %s", test.name);
    await browser?.close();
  }
}

/** Reads the page's log once the test body is done and applies config `logs` (see judgePageLogs) */
async function judgeLogs(page: Page | undefined, testFailed: boolean) {
  if (!page) return {};
  try {
    // Events and command replies share one ordered connection: after this, everything logged so far is in
    await page.syncLogs();
  } catch (err) {
    logger.debug("Could not sync the page's logs", { err });
  }
  let config: LogsConfig | undefined;
  try {
    config = await readConfig("logs");
  } catch (err) {
    logger.debug("Could not read logs config, using defaults", { err });
  }
  return judgePageLogs({
    config,
    entries: page.getLogs(),
    errors: page.pageErrors(),
    dropped: page.logsDropped,
    testFailed,
    allowPageErrors: page.pageErrorsAllowed,
    routeErrors: page.routeErrors(),
  });
}

export { describe, test } from "./registry.js";
