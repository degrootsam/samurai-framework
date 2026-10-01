import assert from "assert";
import { glob } from "node:fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { Browser } from "../browser/browser.js";
import { readConfig } from "../config/config.js";
import logger from "../logger/index.js";
import type { SupportedBrowser } from "../types/browser.js";
import type { RegisteredTestCase, TestFixtures } from "../types/test.js";
import { registeredTests } from "./registry.js";
import type { PreparedRun } from "./prepare-run.js";
import { createEnvFixture } from "../config/variables.js";
import { createSecretsFixture } from "../config/secrets.js";
import TestReporter from "./reporter.js";
import type { SamuraiGroup } from "../types/config.js";
import Page from "../browser/page.js";
import { takePendingAssertions } from "../assert/expect.js";
import { toTestError } from "./test-error.js";
import { judgePageLogs } from "./page-logs-report.js";
import type { LogsConfig } from "./page-logs-report.js";

export default class TestRunner {
  private testFiles: string[];
  private run: PreparedRun;
  private group?: SamuraiGroup;

  constructor(testFiles: string[], run: PreparedRun, group?: SamuraiGroup) {
    this.testFiles = testFiles;
    this.run = run;
    this.group = group;
  }

  static async init(run: PreparedRun, group?: SamuraiGroup) {
    logger.verbose("Initializing test runner");
    let srcDir = "";

    if (group && group.src) {
      srcDir = group.src;
    } else {
      srcDir = (await readConfig("srcDir")) ?? "./src";
    }

    assert(srcDir, "No srcDir declared!");

    const cwd = path.resolve(srcDir);
    logger.verbose("Reading test files from: %s", cwd);
    const testFiles: string[] = [];
    for await (const entry of glob("**/*.spec.ts", {
      cwd,
    })) {
      testFiles.push(entry);
    }
    logger.debug("Found %d tests in srcDir", testFiles.length);
    return new TestRunner(testFiles, run, group);
  }

  public async start() {
    const reporter = new TestReporter({ environment: this.run.settings.environment });
    for (let i = 0; i < this.testFiles.length; i++) {
      const file = this.testFiles[i] as string;
      logger.verbose("Trying to register file: %s", file);
      const targetPath = path.resolve((await readConfig("srcDir")) ?? "./src", file);
      await import(pathToFileURL(targetPath).href);
    }

    logger.verbose("Running test files");

    // TODO: Implement test grouping
    reporter.onStart();
    for (const test of registeredTests()) {
      await this.executeTestCase(test, reporter);
    }
    await reporter.onEnd();
  }

  private async executeTestCase(
    test: RegisteredTestCase,
    reporter: TestReporter,
  ) {
    logger.verbose("Starting test: %s", test.name);
    reporter.onTestStart(test);
    const selectedBrowser: SupportedBrowser = (await readConfig("browser")) ?? "firefox";
    const { settings, secrets } = this.run;
    const timeout = settings.timeout;

    let browser: Browser | undefined;
    let page: Page | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    const timeoutController = new AbortController();

    await Promise.race([
      new Promise<void>((resolve) => {
        timeoutTimer = setTimeout(
          () => {
            reporter.onTestEnd(test, {
              message: `Test timed out after ${timeout / 1000} seconds`,
              type: "timeout",
            });
            timeoutController.abort(new Error("Test timed out"));
            resolve();
          },
          timeout,
        );
      }),
      new Promise<void>(async (resolve, reject) => {
        try {
          const launched = await Browser.launch(
            selectedBrowser,
            {
              port: 9223,
              headless: false,
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
                  .map((matcher) => `expect(locator).${matcher}() was not awaited`)
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
          reporter.onTestEnd(test, toTestError(err), await judgeLogs(page, true));
          resolve();
        }
      }),
    ]);

    clearTimeout(timeoutTimer);
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
