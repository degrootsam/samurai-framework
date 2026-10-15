import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { editConfig, hasConfigPath } from "./config-edit.js";

/** The name is already set in that environment */
export class ExistsError extends Error {}

export const VARIABLE_NAME = /^[A-Za-z_$][\w$]*$/;

/** Adds a variable to one environment in samurai.config.ts; only that property's text changes */
export async function addVariable(
  projectDir: string,
  environment: string,
  name: string,
  value: string,
) {
  if (!VARIABLE_NAME.test(name))
    throw new Error("Use letters, digits and _, starting with a letter.");
  const file = path.join(projectDir, "samurai.config.ts");
  const source = await readFile(file, "utf8");
  if (hasConfigPath(source, ["environments", environment, "variables", name]))
    throw new ExistsError(`"${name}" already exists`);
  await writeFile(
    file,
    editConfig(source, ["environments", environment, "variables", name], value),
  );
}
