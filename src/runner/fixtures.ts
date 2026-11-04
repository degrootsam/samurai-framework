import type { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { createSecretsFixture } from "../config/secrets.js";
import { createEnvFixture } from "../config/variables.js";
import type { SupportedBrowser } from "../types/browser.js";
import type {
  AllHookFixtures,
  RegisteredTestCase,
  TestFixtures,
} from "../types/test.js";
import type { RunnerOptions } from "./options.js";
import type { PreparedRun } from "./prepare-run.js";
import { createInputsFixture, createOutputsFixture } from "./test-io.js";
import type { OutputSink } from "../wait/output-sink.js";

/** What `beforeAll` and `afterAll` hooks get: no page, only what a run knows */
export function allHookFixtures(
  run: PreparedRun,
  browserName: SupportedBrowser,
  workerIndex = 0,
): AllHookFixtures {
  const { settings, secrets } = run;
  return {
    browserName,
    workerIndex,
    env: createEnvFixture(settings.environment, settings.variables),
    secrets: createSecretsFixture(settings.environment, secrets),
  };
}

/** What one run of a test builds its fixtures from */
export interface FixtureSources {
  launched: { page: Page; browser: Browser };
  browserName: SupportedBrowser;
  workerIndex: number;
  run: PreparedRun;
  test: RegisteredTestCase;
  options: RunnerOptions;
  sink: OutputSink;
}

/** The fixtures a test body and its each-hooks receive */
export function buildTestFixtures(from: FixtureSources): TestFixtures {
  const { launched, browserName, workerIndex, run, test, options, sink } = from;
  const { settings, secrets } = run;
  return {
    page: launched.page,
    browser: launched.browser,
    browserName,
    workerIndex,
    env: createEnvFixture(settings.environment, settings.variables),
    secrets: createSecretsFixture(settings.environment, secrets),
    inputs: createInputsFixture(test.inputs, options.inputs),
    outputs: createOutputsFixture(sink),
  };
}
