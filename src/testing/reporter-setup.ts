import { after, afterEach } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import TestReporter from "../runner/reporter.js";
import { resetSecrets } from "../config/mask.js";
import type { RegisteredTestCase } from "../types/test.js";
import { newSuite } from "../runner/suite.js";

export const dir = mkdtempSync(path.join(tmpdir(), "samurai-reporter-"));
/** Cleans the report folder after the file and resets the masked secrets after each test. */
export function installReporterHooks() {
  after(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => resetSecrets());
}

export function testCase(file: string, name: string): RegisteredTestCase {
  return {
    file,
    name,
    titlePath: name.split(" > "),
    suite: newSuite(),
    function: async () => {},
  };
}

export async function report(run: (reporter: TestReporter) => void) {
  const output = path.join(dir, `${Math.random()}.json`);
  const reporter = new TestReporter({
    environment: "staging",
    browsers: ["firefox"],
    output,
  });
  reporter.onStart(0);
  run(reporter);
  await reporter.onEnd();
  return JSON.parse(readFileSync(output, "utf8"));
}
