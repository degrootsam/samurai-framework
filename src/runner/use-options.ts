import { readConfig } from "../config/config.js";
import { groupUseOf } from "../config/group-use.js";
import { mergeUse, useOptionsOf } from "../config/use-options.js";
import logger from "../logger/index.js";
import type { GroupUse, SamuraiGroup } from "../types/config.js";
import type { RegisteredTestCase } from "../types/test.js";
import { useOf } from "./suite.js";

/**
 * The `use` options one test runs with: config `use`, then the `use` of the group the test runs for (if any), then
 * the `test.use()` calls around the test, outermost first, a later one winning key by key
 */
export async function effectiveUse(
  test: RegisteredTestCase,
): Promise<GroupUse> {
  let config: object | undefined;
  let groups: SamuraiGroup[] | undefined;
  try {
    config = await readConfig("use");
    groups = await readConfig("groups");
  } catch (err) {
    logger.debug("Could not read use config, using defaults", { err });
  }
  return mergeUse<GroupUse>([
    useOptionsOf(config),
    test.group === undefined ? {} : groupUseOf(groups, test.group),
    ...useOf(test.suite),
  ]);
}
