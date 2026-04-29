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

const registeredTestcases: RegisteredTestCase[] = [];

export default class TestRunner {
  private testFiles: string[];

  constructor(testFiles: string[]) {
    this.testFiles = testFiles;
  }

  static async init() {
    logger.verbose("Initializing test runner");
    const srcDir = await readConfig("srcDir");
    assert(srcDir, "No srcDir present in config");

    const cwd = path.resolve(srcDir);
    logger.verbose("Reading test files from: %s", cwd);
    const matches: string[] = [];
    for await (const entry of glob("**/*.spec.ts", {
      cwd,
    })) {
      matches.push(entry);
    }
    logger.debug("Found %d tests in srcDir", matches.length);
    return new TestRunner(matches);
  }

  public async run() {
    logger.verbose("Registering test files");
    const reporter = new TestReporter();
    for (let i = 0; i < this.testFiles.length; i++) {
      const file = this.testFiles[i] as string;
      logger.verbose("Trying to register file: %s", file);
      const targetPath = path.resolve(await readConfig("srcDir"), file);
      await import(pathToFileURL(targetPath).href);
    }

    logger.verbose("Running test files");

    // TODO: Implement test grouping
    reporter.onStart({ name: "test", function: async () => {} });
    for (let i = 0; i < registeredTestcases.length; i++) {
      const test = registeredTestcases[i];
      if (!test) continue;
      await this.executeTestCase(test, reporter);
    }
    reporter.onEnd({ name: "test", function: async () => {} });
  }

  private async executeTestCase(
    test: RegisteredTestCase,
    reporter: TestReporter,
  ) {
    logger.verbose("Starting test: %s", test.name);
    reporter.onTestStart(test);
    const startTime = performance.now();
    const selectedBrowser = (await readConfig("browser")) as SupportedBrowser;
    assert(selectedBrowser, "'browser' is missing from config");
    const timeout = Number(await readConfig("timeout"));

    const result = await Promise.race([
      new Promise<void>((resolve) => {
        setTimeout(
          () => {
            reporter.onTestEnd(test, {
              message: "Test timed out after 30 seconds",
              type: "timeout",
            });
            resolve();
          },
          isNaN(timeout) ? 30000 : timeout,
        );
      }),
      new Promise<void>(async (resolve, reject) => {
        try {
          const { browser, page } = await Browser.launch(selectedBrowser, {
            port: 9223,
            headless: false,
          });
          await test?.function(page, browser);
          reporter.onTestEnd(test);
          resolve();
        } catch (err) {
          reporter.onTestEnd(test, {
            message: err instanceof Error ? err.message : (err as string),
            stack: err instanceof Error ? err.stack : undefined,
            type: "error",
          });
          resolve();
        }
      }),
    ]);
  }
}

export function test(name: string, fn: () => Promise<void>) {
  logger.debug("Registered test %s", name);
  const callerLine = new Error().stack;
  const match = callerLine?.match(/\((.+)\)/);
  const location = match?.[1] || "";
  registeredTestcases.push({ name, function: fn, file: location });
}
