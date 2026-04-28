import assert from "assert";
import { readConfig } from "../config/config.js";
import type { TestCase } from "../types/test.js";
import path from "path";
import logger from "../logger/index.js";
import { pathToFileURL } from "url";
import { glob } from "node:fs/promises";

const registeredTestcases: TestCase[] = [];

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
    Promise.race([
      new Promise((resolve) => {
        setTimeout(resolve, 3000);
      }),
      new Promise(async (resolve, reject) => {
        try {
          await test?.function();
          resolve;
        } catch (err) {
          reject(err);
        }
      }),
    ]);
  }
}

export function test(name: string, fn: () => Promise<void>) {
  logger.debug("Registered test %s", name);
  registeredTestcases.push({ name, function: fn });
}
