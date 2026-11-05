import type { FixtureDef } from "./fixture-defs.js";

/** A value as the report lists it */
type OutputValue = string | number | boolean;

/**
 * The declared outputs of a fixture that the report and the app may show: the non-secret keys of its value.
 * Throws when a declared output is not a string, a number or a boolean (the value must be a flat record).
 */
export function outputsOf(
  def: FixtureDef,
  value: unknown,
): Record<string, OutputValue> | undefined {
  const shown = (def.outputs ?? []).filter((output) => !output.secret);
  if (shown.length === 0) return undefined;
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const outputs: Record<string, OutputValue> = {};
  for (const { name } of shown) {
    const output = record[name];
    if (
      typeof output !== "string" &&
      typeof output !== "number" &&
      typeof output !== "boolean"
    )
      throw new Error(`output "${name}" must be a string, number or boolean`);
    outputs[name] = output;
  }
  return outputs;
}

/** JSON with the keys of every object in order, so equal options give equal text */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}
