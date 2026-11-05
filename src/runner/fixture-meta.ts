import type { FixtureField, FixtureOutput } from "../types/extend.js";

/** What a fixture's options say besides `auto`: its scope, and the metadata the app's catalog and the report use */
export interface FixtureMeta {
  scope: "test" | "worker";
  label?: string;
  icon?: string;
  description?: string;
  outputs?: FixtureOutput[];
  timeout?: number;
  /** The fixture is the options of the fixture named without the `Options` suffix */
  option: boolean;
  fields?: FixtureField[];
}

/** The suffix that pairs an option fixture with its fixture: `order` reads `orderOptions` */
export const OPTIONS_SUFFIX = "Options";

const OPTION_KEYS = new Set([
  "auto",
  "scope",
  "label",
  "icon",
  "description",
  "outputs",
  "timeout",
  "option",
  "fields",
]);

const FIELD_TYPES = [
  "text",
  "code",
  "expression",
  "number",
  "select",
  "segmented",
  "switch",
  "secret",
  "variable",
];

const fail = (name: string, problem: string): never => {
  throw new Error(`extend(): fixture "${name}": ${problem}`);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function checkOutputs(name: string, outputs: unknown): FixtureOutput[] {
  if (!Array.isArray(outputs)) return fail(name, "outputs must be an array");
  const seen = new Set<string>();
  for (const output of outputs as unknown[]) {
    if (
      !isObject(output) ||
      typeof output.name !== "string" ||
      output.name === ""
    )
      fail(name, "every output needs a name");
    const { name: key, label, secret } = output as Record<string, unknown>;
    if (seen.has(key as string))
      fail(name, `output "${key as string}" is listed twice`);
    seen.add(key as string);
    if (label !== undefined && typeof label !== "string")
      fail(name, `output "${key as string}": label must be a string`);
    if (secret !== undefined && typeof secret !== "boolean")
      fail(name, `output "${key as string}": secret must be true or false`);
  }
  return outputs as FixtureOutput[];
}

function checkFields(name: string, fields: unknown): FixtureField[] {
  if (!Array.isArray(fields)) return fail(name, "fields must be an array");
  const seen = new Set<string>();
  for (const field of fields as unknown[]) {
    if (!isObject(field) || typeof field.path !== "string" || field.path === "")
      fail(name, "every field needs a path");
    const { path, type, options } = field as Record<string, unknown>;
    if (!FIELD_TYPES.includes(type as string))
      fail(
        name,
        `field "${path as string}" has an unknown type ${JSON.stringify(type)}`,
      );
    if (seen.has(path as string))
      fail(name, `field "${path as string}" is listed twice`);
    seen.add(path as string);
    if ((type === "select" || type === "segmented") && !Array.isArray(options))
      fail(name, `field "${path as string}" needs options`);
  }
  return fields as FixtureField[];
}

/** Checks the options of `[fixture, options]` and returns what the definition keeps; throws `extend(): ...` */
export function checkedOptions(
  name: string,
  options: Record<string, unknown>,
): { auto: boolean; meta: FixtureMeta } {
  for (const key of Object.keys(options))
    if (!OPTION_KEYS.has(key))
      throw new Error(
        `extend(): fixture "${name}" has an unknown option "${key}"`,
      );
  if (options.auto !== undefined && typeof options.auto !== "boolean")
    fail(name, "auto must be true or false");
  if (
    options.scope !== undefined &&
    !["test", "worker"].includes(options.scope as string)
  )
    fail(name, 'scope must be "test" or "worker"');
  if (options.label !== undefined && typeof options.label !== "string")
    fail(name, "label must be a string");
  if (
    options.icon !== undefined &&
    (typeof options.icon !== "string" || options.icon === "")
  )
    fail(name, "icon must be a non-empty string");
  if (
    options.description !== undefined &&
    typeof options.description !== "string"
  )
    fail(name, "description must be a string");
  if (
    options.timeout !== undefined &&
    !(typeof options.timeout === "number" && options.timeout > 0)
  )
    fail(name, "timeout must be a number of milliseconds above 0");
  if (options.option !== undefined && typeof options.option !== "boolean")
    fail(name, "option must be true or false");
  const meta: FixtureMeta = {
    scope: options.scope === "worker" ? "worker" : "test",
    option: options.option === true,
    ...(options.label !== undefined && { label: options.label as string }),
    ...(options.icon !== undefined && { icon: options.icon as string }),
    ...(options.description !== undefined && {
      description: options.description as string,
    }),
    ...(options.timeout !== undefined && {
      timeout: options.timeout as number,
    }),
    ...(options.outputs !== undefined && {
      outputs: checkOutputs(name, options.outputs),
    }),
    ...(options.fields !== undefined && {
      fields: checkFields(name, options.fields),
    }),
  };
  return { auto: options.auto === true, meta };
}
