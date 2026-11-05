/** The key of `use` that attaches fixtures by name (`true`) or removes them (`false`) */
export const FIXTURES_KEY = "fixtures";

const OPTION_FIXTURE_KEY = /^[a-z][A-Za-z0-9]*Options$/;

/** Whether `key` of a `use` object is about fixtures: `fixtures`, or an option fixture (`orderOptions`) */
export function isFixtureUseKey(key: string): boolean {
  return key === FIXTURES_KEY || OPTION_FIXTURE_KEY.test(key);
}

/** The fixture keys of one `use` layer */
export function pickFixtureUse(
  layer: object | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(layer ?? {}).filter(([key]) => isFixtureUseKey(key)),
  );
}

/** The layer without its fixture keys: what is left is for the browser */
export function omitFixtureUse<T extends object>(layer: T | undefined): T {
  return Object.fromEntries(
    Object.entries(layer ?? {}).filter(([key]) => !isFixtureUseKey(key)),
  ) as T;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Checks the fixture keys of one `use` layer; throws `use(): what is wrong` */
export function checkFixtureUse(options: Record<string, unknown>): void {
  const attached = options[FIXTURES_KEY];
  if (attached !== undefined) {
    if (!isObject(attached))
      throw new TypeError(
        "use(): fixtures must be an object of fixture names and true or false",
      );
    for (const [name, on] of Object.entries(attached))
      if (typeof on !== "boolean")
        throw new TypeError(
          `use(): fixtures.${name} must be true or false, got ${JSON.stringify(on)}`,
        );
  }
  for (const [key, value] of Object.entries(options))
    if (key !== FIXTURES_KEY && isFixtureUseKey(key) && !isObject(value))
      throw new TypeError(`use(): ${key} must be an object`);
}

/** What the fixture keys of the layers come to, later layers winning key by key */
export interface MergedFixtureUse {
  /** Fixture name to attached (`true`) or removed (`false`) */
  fixtures: Record<string, boolean>;
  /** Option fixture name to its values from `use`, over the fixture's own default */
  options: Record<string, Record<string, unknown>>;
}

/** Merges the fixture keys of the `use` layers in order (config, environment, group, `test.use()`) */
export function mergeFixtureUse(layers: readonly object[]): MergedFixtureUse {
  const merged: MergedFixtureUse = { fixtures: {}, options: {} };
  for (const layer of layers)
    for (const [key, value] of Object.entries(pickFixtureUse(layer)))
      if (key === FIXTURES_KEY)
        Object.assign(merged.fixtures, value as Record<string, boolean>);
      else
        merged.options[key] = {
          ...merged.options[key],
          ...(value as Record<string, unknown>),
        };
  return merged;
}
