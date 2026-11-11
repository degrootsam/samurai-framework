import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import logger from "../logger/index.js";
import type { SupportedBrowser } from "../types/browser.js";
import { BUILT_IN_FIXTURES, type FixtureLayers } from "./fixture-defs.js";
import { buildTestFixtures } from "./fixtures.js";
import { effectiveFixtureUse } from "./fixture-use.js";
import { FixtureScope } from "./fixture-scope.js";
import type { PreparedRun } from "./prepare-run.js";
import { RequestFixture } from "./request-fixture.js";
import { loadSpecs } from "./select.js";
import { isSkipSignal } from "./skip.js";
import { TestInfoImpl } from "./test-info.js";
import { effectiveUse } from "./use-options.js";
import { beginOutputs, endOutputs } from "../wait/output-sink.js";

/** What setting up the fixtures of one test on an open page needs */
export interface PageFixturesInput {
  /** The spec file, absolute */
  file: string;
  /** Full name of the test in it */
  testName: string;
  page: Page;
  browser: Browser;
  browserName: SupportedBrowser;
  run: PreparedRun;
  /** Whether the project has fixtures at all: without them (and none asked for by the test) the spec is not loaded */
  projectHasFixtures: boolean;
  /** The names the test function destructures, from the parsed spec */
  requested: readonly string[];
}

/** Fixtures set up on a page that is already open; `teardown` finishes them, last first */
export interface PageFixtures {
  /** The custom fixtures that were set up, in the order they were */
  names: string[];
  /** Returns the first error of a cleanup that failed; never throws */
  teardown(): Promise<Error | undefined>;
}

/**
 * Sets up the custom fixtures a test would get in a run, on a page that is already open: the `auto` ones, the ones
 * `use.fixtures` attaches (config, environment, test) and the ones the test function destructures. Used where a test
 * is not run but its page state is needed (the agent continuing a test). The spec is imported to find the test and
 * the `test.extend()` it was made with; a test made with the plain `test` has none, and so does a project
 * without `config.fixtures` whose test asks for no custom fixture, which is not even imported. A fixture whose
 * setup throws, or that the environment turns off, throws an error that names it (the ones already set up are
 * finished first). The test's `beforeEach` hooks are not run.
 */
export async function setUpPageFixtures(
  input: PageFixturesInput,
): Promise<PageFixtures | undefined> {
  const asked = input.requested.some((name) => !BUILT_IN_FIXTURES.has(name));
  if (!input.projectHasFixtures && !asked) return undefined;
  const { all } = await loadSpecs([input.file]);
  const test = all.find((one) => one.name === input.testName);
  if (!test)
    throw new Error(
      `the fixtures of "${input.testName}" cannot be set up: the spec file does not register a test with that name`,
    );
  if (!test.extension) return undefined;
  const { settings } = input.run;
  const resultDir = await mkdtemp(path.join(os.tmpdir(), "samurai-replay-"));
  const use = await effectiveUse(test);
  const request = new RequestFixture(settings.baseURL, use);
  const sink = beginOutputs(test.outputs ?? []);
  const info = new TestInfoImpl({
    test,
    browserName: input.browserName,
    workerIndex: 0,
    retry: 0,
    settings: { baseURL: settings.baseURL, timeout: settings.timeout },
    resultDir,
    outputDir: path.join(resultDir, "attachments"),
  });
  const scope = new FixtureScope(
    test.extension as FixtureLayers,
    buildTestFixtures({
      launched: { page: input.page, browser: input.browser },
      browserName: input.browserName,
      workerIndex: 0,
      run: input.run,
      test,
      options: {},
      sink,
      info,
      request,
      device: { isMobile: false, hasTouch: false },
    }),
    { ...(await effectiveFixtureUse(test)), environment: settings.environment },
  );
  const teardown = async () => {
    const error = await scope.teardown(settings.timeout);
    await request.dispose().catch(() => undefined);
    endOutputs();
    await rm(resultDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
    return error;
  };
  try {
    await scope.prepareAuto();
    await scope.prepare(test.function);
  } catch (error) {
    const late = await teardown();
    if (late) logger.debug("A fixture failed after its setup failed", { late });
    throw isSkipSignal(error)
      ? new Error(`${error.message}, so its fixtures cannot be set up`)
      : error;
  }
  return {
    names: scope.report().map((entry) => entry.name),
    teardown,
  };
}
