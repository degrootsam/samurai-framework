import assert from "assert";
import { glob } from "node:fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { Browser } from "../browser/browser.js";
import { readConfig } from "../config/config.js";
import logger from "../logger/index.js";
import type { SupportedBrowser } from "../types/browser.js";
import type { RegisteredTestCase, TestResult } from "../types/test.js";
import TestReporter from "./reporter.js";
import type { SamuraiGroup } from "../types/config.js";
import Page from "../browser/page.js";

const registeredTestcases: RegisteredTestCase[] = [];

export default class TestRunner {
  private testFiles: string[];
  private group?: SamuraiGroup;

  constructor(testFiles: string[], group?: SamuraiGroup) {
    this.testFiles = testFiles;
    this.group = group;
  }

  static async init(group?: SamuraiGroup) {
    logger.verbose("Initializing test runner");
    let srcDir = "";

    if (group && group.src) {
      srcDir = group.src;
    } else {
      srcDir = await readConfig("srcDir");
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
    return new TestRunner(testFiles);
  }

  public async run() {
    const reporter = new TestReporter();
    for (let i = 0; i < this.testFiles.length; i++) {
      const file = this.testFiles[i] as string;
      logger.verbose("Trying to register file: %s", file);
      const targetPath = path.resolve(await readConfig("srcDir"), file);
      await import(pathToFileURL(targetPath).href);
    }

    logger.verbose("Running test files");

    // TODO: Implement test grouping
    reporter.onStart();
    for (let i = 0; i < registeredTestcases.length; i++) {
      const test = registeredTestcases[i];
      if (!test) continue;
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
    let selectedBrowser: SupportedBrowser = "firefox";
    if (this.group && this.group?.browser) {
      selectedBrowser = this.group.browser;
    } else {
      selectedBrowser = await readConfig("browser");
    }
    assert(selectedBrowser, "'browser' is missing from config");
    const timeout = Number(await readConfig("timeout"));

    let browser: Browser | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    const timeoutController = new AbortController();

    await Promise.race([
      new Promise<void>((resolve) => {
        timeoutTimer = setTimeout(
          () => {
            reporter.onTestEnd(test, {
              message: `Test timed out after ${(timeout || 30000) / 1000} seconds`,
              type: "timeout",
            });
            timeoutController.abort(new Error("Test timed out"));
            resolve();
          },
          isNaN(timeout) ? 30000 : timeout,
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
          await test?.function(launched.page, launched.browser);
          // Already reported as timed out
          if (timeoutController.signal.aborted) return resolve();
          reporter.onTestEnd(test);
          resolve();
        } catch (err) {
          if (timeoutController.signal.aborted) return resolve();
          reporter.onTestEnd(test, {
            message: err instanceof Error ? err.message : (err as string),
            stack: err instanceof Error ? err.stack : undefined,
            type: "error",
          });
          resolve();
        }
      }),
    ]);

    clearTimeout(timeoutTimer);
    logger.verbose("Closing browser for test: %s", test.name);
    await browser?.close();
  }
}

export function test(
  name: string,
  fn: (page: Page, browser: Browser) => Promise<void>,
) {
  logger.debug("Registered test %s", name);
  const callerLine = new Error().stack;
  const match = callerLine?.match(/\((.+)\)/);
  const location = match?.[1] || "";
  registeredTestcases.push({ name, function: fn, file: location });
}
