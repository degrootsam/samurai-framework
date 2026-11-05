import { requestedBy } from "./fixture-args.js";

/** The function of a fixture: sets the value up, calls `use(value)`, cleans up after `use` returns */
type FixtureSetup = (
  args: Record<string, unknown>,
  use: (value: unknown) => Promise<void>,
) => Promise<void>;

/** One definition of a fixture: the value or the setup function, what it depends on, whether every test gets it */
export interface FixtureDef {
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

const OPTION_KEYS = new Set(["auto", "scope"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** `[fixture, options]` is always a pair with options; an array value goes in a function */
function checkedOptions(name: string, options: Record<string, unknown>) {
  for (const key of Object.keys(options))
    if (!OPTION_KEYS.has(key))
      throw new Error(
        `extend(): fixture "${name}" has an unknown option "${key}"`,
      );
  if (options.auto !== undefined && typeof options.auto !== "boolean")
    throw new Error(`extend(): fixture "${name}": auto must be true or false`);
  if (options.scope === "worker")
    throw new Error(
      `extend(): fixture "${name}" has scope "worker", which is not supported; fixtures live as long as one test ({ scope: "test" })`,
    );
  if (options.scope !== undefined && options.scope !== "test")
    throw new Error(`extend(): fixture "${name}": scope must be "test"`);
  return { auto: options.auto === true };
}

function definitionOf(name: string, raw: unknown): FixtureDef {
  const [fixture, options] =
    Array.isArray(raw) && raw.length === 2 && isPlainObject(raw[1])
      ? ([raw[0] as unknown, checkedOptions(name, raw[1])] as const)
      : ([raw, { auto: false }] as const);
  if (typeof fixture !== "function")
    return { name, auto: options.auto, deps: [], value: fixture };
  const requested = requestedBy(fixture as (...args: never[]) => unknown);
  if (requested.kind === "opaque" || requested.rest)
    throw new Error(
      `extend(): fixture "${name}" must destructure the fixtures it uses in its first argument, as ({ page }, use) or ({}, use)`,
    );
  return {
    name,
    auto: options.auto,
    deps: requested.names,
    setup: fixture as FixtureSetup,
  };
}

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
      if (target !== "built-in")
        walk(target.name, target.level, [...path, key]);
    }
    done.add(key);
  };
  for (const [name, defs] of layers)
    for (let level = 0; level < defs.length; level++) walk(name, level, []);
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
