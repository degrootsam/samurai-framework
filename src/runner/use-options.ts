import { readConfig } from "../config/config.js";
import { omitFixtureUse } from "../config/fixture-use.js";
import { groupUseOf } from "../config/group-use.js";
import { peekRunSettings } from "../config/run-settings.js";
import { mergeUse, useOptionsOf } from "../config/use-options.js";
import logger from "../logger/index.js";
import type { GroupUse, SamuraiGroup } from "../types/config.js";
import type { RegisteredTestCase } from "../types/test.js";
import { useOf } from "./suite.js";

/** The `use` objects that apply to one test, as written, lowest layer first */
export interface UseLayers {
  /** Config `use` */
  config: object;
  /** `environments.<name>.use` of the run's environment */
  environment: object;
  /** `use` of the group the test runs for */
  group: object;
  /** The `test.use()` calls around the test, outermost first */
  tests: object[];
}

/** The `use` layers of a test: config, then the run's environment, then the group it runs for, then `test.use()` */
export async function useLayers(test: RegisteredTestCase): Promise<UseLayers> {
  let config: object | undefined;
  let groups: SamuraiGroup[] | undefined;
  let environments: Record<string, { use?: object }> | undefined;
  try {
    config = await readConfig("use");
    groups = await readConfig("groups");
    environments = await readConfig("environments");
  } catch (err) {
    logger.debug("Could not read use config, using defaults", { err });
  }
  const environment = peekRunSettings()?.environment;
  return {
    config: config ?? {},
    environment:
      (environment !== undefined &&
        Object.prototype.hasOwnProperty.call(environments ?? {}, environment) &&
        environments?.[environment]?.use) ||
      {},
    group: test.group === undefined ? {} : groupUseOf(groups, test.group),
    tests: useOf(test.suite),
  };
}

/**
 * The `use` options one test runs with: config `use`, then the `use` of the run's environment, then the `use` of
 * the group the test runs for (if any), then the `test.use()` calls around the test, outermost first, a later one
 * winning key by key. The fixture keys (`fixtures`, `orderOptions`) are for the fixtures: see `effectiveFixtureUse`.
 */
export async function effectiveUse(
  test: RegisteredTestCase,
): Promise<GroupUse> {
  const layers = await useLayers(test);
  return mergeUse<GroupUse>([
    useOptionsOf(layers.config),
    omitFixtureUse(layers.environment),
    omitFixtureUse(layers.group),
    ...layers.tests.map((layer) => omitFixtureUse(layer)),
  ]);
}
