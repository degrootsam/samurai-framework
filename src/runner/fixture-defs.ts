import { requestedBy } from "./fixture-args.js";
import {
  checkedOptions,
  OPTIONS_SUFFIX,
  type FixtureMeta,
} from "./fixture-meta.js";

/** The function of a fixture: sets the value up, calls `use(value)`, cleans up after `use` returns */
type FixtureSetup = (
  args: Record<string, unknown>,
  use: (value: unknown) => Promise<void>,
) => Promise<void>;

/** One definition of a fixture: the value or the setup function, what it depends on, whether every test gets it */
export interface FixtureDef extends FixtureMeta {
  name: string;
  auto: boolean;
  deps: string[];
  setup?: FixtureSetup;
  value?: unknown;
}

/** Every custom fixture by name; the last definition of a name wins, the ones before it are what it may depend on by its own name */
export type FixtureLayers = ReadonlyMap<string, readonly FixtureDef[]>;

/** The fixtures the runner builds for every test: a custom fixture of the same name overrides it */
export const BUILT_IN_FIXTURES: ReadonlySet<string> = new Set([
  "page",
  "browser",
  "browserName",
  "workerIndex",
  "env",
  "secrets",
  "inputs",
  "outputs",
  "context",
  "baseURL",
  "request",
  "testInfo",
  "isMobile",
  "hasTouch",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function definitionOf(name: string, raw: unknown): FixtureDef {
  const [fixture, options] =
    Array.isArray(raw) && raw.length === 2 && isPlainObject(raw[1])
      ? ([raw[0] as unknown, checkedOptions(name, raw[1])] as const)
      : ([raw, checkedOptions(name, {})] as const);
  const { auto, meta } = options;
  checkOptionFixture(name, fixture, meta);
  if (typeof fixture !== "function")
    return { name, auto, deps: [], value: fixture, ...meta };
  const requested = requestedBy(fixture as (...args: never[]) => unknown);
  if (requested.kind === "opaque" || requested.rest)
    throw new Error(
      `extend(): fixture "${name}" must destructure the fixtures it uses in its first argument, as ({ page }, use) or ({}, use)`,
    );
  return {
    name,
    auto,
    deps: requested.names,
    setup: fixture as FixtureSetup,
    ...meta,
  };
}

/** `option: true` and `fields` go together with a name ending in `Options` and a plain object as the value */
function checkOptionFixture(
  name: string,
  fixture: unknown,
  meta: FixtureMeta,
): void {
  const suffixed = name.endsWith(OPTIONS_SUFFIX) && name !== OPTIONS_SUFFIX;
  if (!meta.option) {
    if (meta.fields)
      throw new Error(
        suffixed
          ? `extend(): fixture "${name}" has fields but option is not true`
          : `extend(): fixture "${name}" has fields but is not an option fixture; put them on "${name}${OPTIONS_SUFFIX}" (option: true)`,
      );
    return;
  }
  if (!suffixed)
    throw new Error(
      `extend(): fixture "${name}" is an option fixture, so its name must end in "${OPTIONS_SUFFIX}"`,
    );
  if (typeof fixture === "function")
    throw new Error(
      `extend(): option fixture "${name}" must be a plain object, not a function`,
    );
  if (!isPlainObject(fixture))
    throw new Error(
      `extend(): option fixture "${name}" must be a plain object`,
    );
}

/** The name of the fixture an option fixture belongs to */
const fixtureOf = (optionName: string): string =>
  optionName.slice(0, -OPTIONS_SUFFIX.length);

/** Where a dependency of `name` (at definition `level`) comes from: another definition, or the built-in fixture */
export function dependencyOf(
  layers: FixtureLayers,
  name: string,
  level: number,
  dep: string,
): { name: string; level: number } | "built-in" | undefined {
  if (dep === name)
    return level > 0
      ? { name, level: level - 1 }
      : BUILT_IN_FIXTURES.has(dep)
        ? "built-in"
        : undefined;
  const defs = layers.get(dep);
  if (defs) return { name: dep, level: defs.length - 1 };
  return BUILT_IN_FIXTURES.has(dep) ? "built-in" : undefined;
}

/** The built-in fixtures a worker fixture may use: those that do not belong to one test or one page */
const WORKER_BUILT_INS = new Set([
  "browserName",
  "workerIndex",
  "env",
  "secrets",
  "baseURL",
]);

/** A worker fixture outlives every test: it may use the run's values, other worker fixtures and plain values */
function checkWorkerDependency(
  layers: FixtureLayers,
  def: FixtureDef,
  dep: string,
  target: ReturnType<typeof dependencyOf>,
): void {
  if (target === "built-in") {
    if (!WORKER_BUILT_INS.has(dep))
      throw new Error(
        `extend(): worker fixture "${def.name}" cannot use "${dep}"; it lives longer than one test (it may use ${[...WORKER_BUILT_INS].join(", ")}, other worker fixtures and values)`,
      );
    return;
  }
  const used = target && layers.get(target.name)?.[target.level];
  if (used && used.scope !== "worker" && used.setup)
    throw new Error(
      `extend(): worker fixture "${def.name}" cannot use the test-scoped fixture "${dep}"`,
    );
}

/** Throws for a dependency nobody defines and for a cycle (`a` needs `b` needs `a`) */
function validate(layers: FixtureLayers): void {
  const done = new Set<string>();
  const walk = (name: string, level: number, path: string[]): void => {
    const key = `${name}#${level}`;
    if (done.has(key)) return;
    if (path.includes(key)) {
      const loop = [...path.slice(path.indexOf(key)), key];
      throw new Error(
        `extend(): fixtures depend on each other in a circle: ${loop.map((k) => k.split("#")[0]).join(" -> ")}`,
      );
    }
    const def = layers.get(name)?.[level];
    if (!def) return;
    for (const dep of def.deps) {
      const target = dependencyOf(layers, name, level, dep);
      if (target === undefined)
        throw new Error(
          `extend(): fixture "${name}" depends on unknown fixture "${dep}"`,
        );
      if (def.scope === "worker")
        checkWorkerDependency(layers, def, dep, target);
      if (target !== "built-in")
        walk(target.name, target.level, [...path, key]);
    }
    done.add(key);
  };
  for (const [name, defs] of layers) {
    if (defs[defs.length - 1]?.option && !layers.has(fixtureOf(name)))
      throw new Error(
        `extend(): option fixture "${name}" has no fixture "${fixtureOf(name)}"`,
      );
    for (let level = 0; level < defs.length; level++) walk(name, level, []);
  }
}

/** The fixtures after `test.extend(definitions)` on a test that has `base`; throws `extend(): ...` for a definition that cannot work */
export function extendLayers(
  base: FixtureLayers | undefined,
  definitions: unknown,
): FixtureLayers {
  if (!isPlainObject(definitions))
    throw new Error("extend(): needs an object of fixtures");
  const layers = new Map<string, readonly FixtureDef[]>(base);
  for (const [name, raw] of Object.entries(definitions))
    layers.set(name, [...(layers.get(name) ?? []), definitionOf(name, raw)]);
  validate(layers);
  return layers;
}
