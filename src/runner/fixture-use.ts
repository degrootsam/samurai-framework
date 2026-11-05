import {
  FIXTURES_KEY,
  mergeFixtureUse,
  pickFixtureUse,
} from "../config/fixture-use.js";
import { peekRunSettings } from "../config/run-settings.js";
import type { SamuraiTestConfig } from "../types/config.js";
import type { RegisteredTestCase } from "../types/test.js";
import type { FixtureLayers } from "./fixture-defs.js";
import type { FixtureCatalogEntry } from "./fixture-registry.js";
import { useLayers } from "./use-options.js";

/** What the fixture keys of the `use` layers come to for one test */
export interface ResolvedFixtureUse {
  /** The fixtures to set up before `beforeEach`, besides the `auto` ones; one the environment turns off is still listed when a later layer insists, and skips the test */
  attach: string[];
  /** Option fixture name to its values from `use`, over the fixture's own default */
  options: Record<string, Record<string, unknown>>;
  /** Fixtures the run's environment turns off, with the reason a test that needs one is skipped for */
  disabled: Map<string, string>;
}

/**
 * The fixtures a test gets from `use`: config, then the run's environment, then the group, then `test.use()`, a
 * later layer winning key by key. The environment's `false` is the exception: it wins over a `true` anywhere, so a
 * fixture an environment turns off cannot be switched back on for it.
 */
export async function effectiveFixtureUse(
  test: RegisteredTestCase,
): Promise<ResolvedFixtureUse> {
  const layers = await useLayers(test);
  const merged = mergeFixtureUse([
    layers.config,
    layers.environment,
    layers.group,
    ...layers.tests,
  ]);
  const environment = peekRunSettings()?.environment ?? "";
  const disabled = new Map<string, string>();
  for (const [name, on] of Object.entries(
    mergeFixtureUse([layers.environment]).fixtures,
  ))
    if (!on)
      disabled.set(name, `Fixture ${name} is turned off in ${environment}`);
  return {
    attach: Object.entries(merged.fixtures)
      .filter(([, on]) => on)
      .map(([name]) => name),
    options: merged.options,
    disabled,
  };
}

const list = (names: string[], none: string) =>
  names.length > 0 ? names.join(", ") : none;

/** Throws when a `use` names a fixture or an option fixture that `catalog` does not have */
function checkPlace(
  place: string,
  use: object | undefined,
  catalog: readonly FixtureCatalogEntry[],
): void {
  const fixtures = catalog.map((entry) => entry.name);
  const options = catalog.flatMap((entry) => entry.options?.name ?? []);
  for (const [key, value] of Object.entries(pickFixtureUse(use))) {
    if (key === FIXTURES_KEY) {
      for (const name of Object.keys(value as object))
        if (!fixtures.includes(name))
          throw new Error(
            `${place}.fixtures: unknown fixture "${name}". ${fixtures.length > 0 ? `Known fixtures: ${list(fixtures, "")}` : "No fixtures are listed in config.fixtures"}`,
          );
    } else if (!options.includes(key))
      throw new Error(
        `${place}.${key}: unknown option fixture "${key}". ${options.length > 0 ? `Known option fixtures: ${list(options, "")}` : "No option fixtures are listed in config.fixtures"}`,
      );
  }
}

/** Refuses a config whose `use` (config, environments, groups) names a fixture that is not in `config.fixtures` */
export function checkFixtureUseNames(
  config: SamuraiTestConfig,
  catalog: readonly FixtureCatalogEntry[],
): void {
  checkPlace("config.use", config.use, catalog);
  for (const [name, environment] of Object.entries(config.environments ?? {}))
    checkPlace(`config.environments.${name}.use`, environment.use, catalog);
  config.groups?.forEach((group, index) =>
    checkPlace(`config.groups[${index}].use`, group.use, catalog),
  );
}

/** Refuses a `test.use()` that names a fixture the test's own `test.extend()` does not define */
export function checkTestFixtureUse(
  use: object,
  layers: FixtureLayers | undefined,
): void {
  for (const [key, value] of Object.entries(pickFixtureUse(use))) {
    const known = [...(layers?.keys() ?? [])];
    if (key === FIXTURES_KEY) {
      for (const name of Object.keys(value as object))
        if (!layers?.has(name))
          throw new TypeError(
            `use(): unknown fixture "${name}". ${known.length > 0 ? `This test has: ${known.join(", ")}` : "This test has no fixtures; write it with test.extend()"}`,
          );
    } else if (!layers?.get(key)?.slice(-1)[0]?.option)
      throw new TypeError(`use(): unknown option fixture "${key}"`);
  }
}
