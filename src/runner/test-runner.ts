import assert from "assert";
import { glob } from "node:fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { readConfig } from "../config/config.js";
import logger from "../logger/index.js";
import type { TestCase, TestResult, TestResultBase } from "../types/test.js";

const registeredTestcases: TestCase[] = [];

export default class TestRunner {
  private testFiles: string[];
  private results: TestResult[] = [];

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
    for (let i = 0; i < this.testFiles.length; i++) {
      const file = this.testFiles[i] as string;
      logger.verbose("Trying to register file: %s", file);
      const targetPath = path.resolve(await readConfig("srcDir"), file);
      await import(pathToFileURL(targetPath).href);
    }

    logger.verbose("Running test files");
    for (let i = 0; i < registeredTestcases.length; i++) {
      const test = registeredTestcases[i] as TestCase;
      await this.executeTestCase(test);
    }
  }

  private async executeTestCase(test: TestCase) {
    const startTime = performance.now();

    const result = await Promise.race([
      new Promise<TestResult>((resolve) => {
        setTimeout(() => {
          resolve({
            status: "failed",
            name: test.name,
            error: {
              message: "Test timed out after 30 seconds",
              type: "timeout",
            },
            duration: performance.now() - startTime,
            startTime,
          });
        }, 30000);
      }),
      new Promise<TestResult>(async (resolve, reject) => {
        try {
          await test?.function();
          resolve({
            status: "success",
            startTime,
            duration: performance.now() - startTime,
            name: test.name,
          });
        } catch (err) {
          resolve({
            status: "failed",
            error: {
              message: err instanceof Error ? err.message : (err as string),
              location: err instanceof Error ? err.stack : undefined,
              type: "error",
            },
            startTime,
            duration: performance.now() - startTime,
            name: test.name,
          });
        }
      }),
    ]);
    this.results.push(result);
  }
}

export function test(name: string, fn: () => Promise<void>) {
  logger.debug("Registered test %s", name);
  registeredTestcases.push({ name, function: fn });
}
