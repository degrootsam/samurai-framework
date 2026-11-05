import { readConfig } from "../config/config.js";
import { mergeUse, useOptionsOf } from "../config/use-options.js";
import logger from "../logger/index.js";
import type { RegisteredTestCase } from "../types/test.js";
import type { UseOptions } from "../types/use.js";
import { useOf } from "./suite.js";

/**
 * The `use` options one test runs with: config `use`, then the `test.use()` calls around the test, outermost
 * first, a later one winning key by key
 */
export async function effectiveUse(
  test: RegisteredTestCase,
): Promise<UseOptions> {
  let config: object | undefined;
  try {
    config = await readConfig("use");
  } catch (err) {
    logger.debug("Could not read use config, using defaults", { err });
  }
  return mergeUse([useOptionsOf(config), ...useOf(test.suite)]);
}
