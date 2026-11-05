import type { FixtureField, FixtureOutput } from "../types/extend.js";
import {
  BUILT_IN_FIXTURES,
  type FixtureDef,
  type FixtureLayers,
} from "./fixture-defs.js";

/** The fixtures each `test.extend()` result carries; the test function itself holds nothing a config could read */
const layersByTest = new WeakMap<object, FixtureLayers>();

/** Remembers the fixtures of an extended `test`, so `config.fixtures` can be read without running a test */
export function rememberLayers(test: object, layers: FixtureLayers): void {
  layersByTest.set(test, layers);
}

/** What the app and the CLI show of one fixture of a project, read without running a test */
export interface FixtureCatalogEntry {
  name: string;
  /** The `label` option, else the name */
  label: string;
  icon?: string;
  description?: string;
  scope: "test" | "worker";
  /** Set up for every test */
  auto: boolean;
  /** The name is a built-in fixture's: this one replaces it */
  overridesBuiltIn: boolean;
  /** The fixtures it destructures, built-in ones included */
  dependencies: string[];
  /** The `<name>Options` fixture: its form, and its values when `use` sets none */
  options?: {
    name: string;
    fields: FixtureField[];
    defaults: Record<string, unknown>;
  };
  /** The declared keys of its value, without the secret ones */
  outputs?: FixtureOutput[];
}

const NAME = /^[a-z][A-Za-z0-9]*$/;

const fail = (problem: string): never => {
  throw new Error(`config.fixtures: ${problem}`);
};

/** The last definition of every name in the listed tests, with the place of the first test that has it */
function collect(tests: readonly unknown[]): Map<string, FixtureDef> {
  const found = new Map<string, { def: FixtureDef; index: number }>();
  tests.forEach((test, index) => {
    const layers =
      (typeof test === "function" ||
        (typeof test === "object" && test !== null)) &&
      layersByTest.has(test)
        ? layersByTest.get(test)
        : undefined;
    if (
      layers === undefined &&
      !(typeof test === "function" && "extend" in test)
    )
      throw new Error(
        `config.fixtures[${index}] is not a test (use the result of test.extend())`,
      );
    for (const [name, defs] of layers ?? []) {
      const def = defs[defs.length - 1]!;
      const earlier = found.get(name);
      if (earlier && earlier.def !== def)
        fail(
          `fixture "${name}" is defined twice (config.fixtures[${earlier.index}] and config.fixtures[${index}])`,
        );
      if (!earlier) found.set(name, { def, index });
    }
  });
  return new Map([...found].map(([name, { def }]) => [name, def]));
}

/**
 * The catalog of the fixtures in `config.fixtures`, read from the extended tests without running anything. Throws
 * `config.fixtures: ...` for a list entry that is not an extended test, a name that does not match
 * `/^[a-z][A-Za-z0-9]*$/` and a name defined in two places.
 */
export function fixtureCatalog(
  tests: readonly unknown[],
): FixtureCatalogEntry[] {
  if (!Array.isArray(tests))
    throw new Error("config.fixtures must be an array");
  const defs = collect(tests);
  for (const name of defs.keys())
    if (!NAME.test(name))
      fail(
        `fixture name "${name}" must match ${NAME} (letters and digits, starting with a lower-case letter)`,
      );
  return [...defs.values()]
    .filter((def) => !def.option)
    .map((def): FixtureCatalogEntry => {
      const option = defs.get(`${def.name}Options`);
      const outputs = def.outputs?.filter((output) => !output.secret);
      return {
        name: def.name,
        label: def.label ?? def.name,
        ...(def.icon !== undefined && { icon: def.icon }),
        ...(def.description !== undefined && { description: def.description }),
        scope: def.scope,
        auto: def.auto,
        overridesBuiltIn: BUILT_IN_FIXTURES.has(def.name),
        dependencies: def.deps,
        ...(option?.option && {
          options: {
            name: option.name,
            fields: option.fields ?? [],
            defaults: { ...(option.value as Record<string, unknown>) },
          },
        }),
        ...(outputs && outputs.length > 0 && { outputs }),
      };
    });
}
