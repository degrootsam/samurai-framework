import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PREFIX = "SAMURAI_SECRET_";
export const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;
const ENVIRONMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function envFile(projectDir: string, environment: string) {
  // The name ends up in a file name: keep it to plain characters
  if (!ENVIRONMENT.test(environment))
    throw new Error(`"${environment}" isn't a valid environment name.`);
  return path.join(projectDir, `.env.${environment}`);
}

function checkName(name: string) {
  if (!SECRET_NAME.test(name))
    throw new Error("Use letters, digits and _; a secret is UPPER_SNAKE_CASE.");
}

/**
 * dotenv value: bare when that is safe, else in the quotes that need no escaping. Node's parser, which the
 * framework reads these files with, can't escape a quote inside a quote, so the quote kind is picked to not
 * occur in the value.
 */
function formatValue(value: string) {
  if (/^[A-Za-z0-9_./:@%+=-]*$/.test(value)) return value;
  if (!value.includes("'") && !/[\r\n]/.test(value)) return `'${value}'`;
  if (!value.includes("`")) return `\`${value}\``;
  if (!value.includes('"') && !value.includes("\\") && !/[\r\n]/.test(value))
    return `"${value}"`;
  throw new Error(
    "This value has both ' and ` characters (and more), which a .env file can't hold. Set it as a SAMURAI_SECRET_* environment variable instead.",
  );
}

const lineFor = (name: string) =>
  new RegExp(`^[ \\t]*(?:export[ \\t]+)?${PREFIX}${name}[ \\t]*=`);

/** Whether .gitignore covers this file: its name, or `.env*` / `.env.*` */
export async function isGitIgnored(projectDir: string, file: string) {
  try {
    const text = await readFile(path.join(projectDir, ".gitignore"), "utf8");
    return text.split(/\r?\n/).some((l) => {
      const line = l.trim().replace(/^\//, "");
      return line === file || line === ".env*" || line === ".env.*";
    });
  } catch {
    return false;
  }
}

/** Sets SAMURAI_SECRET_<name> in .env.<environment>, replacing its line or adding one */
export async function setSecret(
  projectDir: string,
  environment: string,
  name: string,
  value: string,
) {
  checkName(name);
  if (value === "")
    throw new Error("A secret can't be empty. Remove it instead.");
  if (/\r|\n/.test(value) && !value.trim())
    throw new Error("A secret can't be only line breaks.");
  const file = envFile(projectDir, environment);
  const text = existsSync(file) ? await readFile(file, "utf8") : "";
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const line = `${PREFIX}${name}=${formatValue(value)}`;
  const at = lines.findIndex((l) => lineFor(name).test(l));
  if (at >= 0) lines[at] = line;
  else lines.push(line);
  await writeFile(file, lines.join("\n") + "\n", { mode: 0o600 });
}
