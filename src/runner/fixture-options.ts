import type { TestFixtures } from "../types/test.js";
import type { FixtureDef } from "./fixture-defs.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The object at `path` (dots go into objects) and the last key, or nothing when the path leads nowhere */
function parentOf(
  value: Record<string, unknown>,
  path: string,
): { parent: Record<string, unknown>; key: string } | undefined {
  const keys = path.split(".");
  let parent = value;
  for (const key of keys.slice(0, -1)) {
    const next = parent[key];
    if (!isObject(next)) return undefined;
    parent = next;
  }
  return { parent, key: keys[keys.length - 1]! };
}

/**
 * The value an option fixture gives: its default with the values from `use` over it, key by key. A field of type
 * `secret` holds the name of a secret and one of type `variable` the name of a variable; they are replaced by the
 * secret's or the variable's value here, so the fixture never sees the name.
 */
export function resolveOptions(
  def: FixtureDef,
  fromUse: Readonly<Record<string, unknown>> | undefined,
  base: Pick<TestFixtures, "env" | "secrets">,
): Record<string, unknown> {
  const merged = structuredClone({
    ...(def.value as Record<string, unknown>),
    ...fromUse,
  });
  for (const field of def.fields ?? []) {
    if (field.type !== "secret" && field.type !== "variable") continue;
    const place = parentOf(merged, field.path);
    const name = place?.parent[place.key];
    if (!place || typeof name !== "string" || name === "") continue;
    place.parent[place.key] =
      field.type === "secret" ? base.secrets[name] : base.env[name];
  }
  return merged;
}
