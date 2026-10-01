import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inspect, parseEnv } from "node:util";
import { projectDir } from "./config.js";
import logger from "../logger/index.js";
import { MASK } from "./mask.js";
import { isPassthroughKey } from "./variables.js";

const PREFIX = "SAMURAI_SECRET_";
const NAME = /^[A-Z][A-Z0-9_]*$/;

export class MissingSecretError extends Error {
  constructor(name: string, environment: string) {
    super(
      `Secret "${name}" is not set (expected env var ${PREFIX}${name} or .env.${environment})`,
    );
    this.name = "MissingSecretError";
  }
}

/** Secrets by name: `.env.<environment>` in `cwd` first, then env vars (which win) */
export function loadSecrets(
  environment: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Map<string, string> {
  const file = path.join(options.cwd ?? projectDir(), `.env.${environment}`);
  const sources: Array<Record<string, string | undefined>> = [];
  if (existsSync(file))
    sources.push(
      parseEnv(readFileSync(file, "utf8")) as Record<string, string>,
    );
  sources.push(options.env ?? process.env);

  const secrets = new Map<string, string>();
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (!key.startsWith(PREFIX) || value === undefined || value === "")
        continue;
      const name = key.slice(PREFIX.length);
      if (!NAME.test(name)) {
        logger.warn(`Ignoring ${key}: secret names must be UPPER_SNAKE_CASE`);
        continue;
      }
      secrets.set(name, value);
    }
  }
  return secrets;
}

/** The test's `secrets`: values by name, read-only; JSON and inspect show only masks */
export function createSecretsFixture(
  environment: string,
  values: ReadonlyMap<string, string>,
): Readonly<Record<string, string>> {
  const masked = () =>
    Object.fromEntries([...values.keys()].map((name) => [name, MASK]));
  // Not frozen: the get trap returns the real value, which a frozen target's invariants forbid
  const target: Record<string, string> = masked();
  Object.defineProperty(target, "toJSON", { value: masked, enumerable: false });
  Object.defineProperty(target, inspect.custom, {
    value: masked,
    enumerable: false,
  });
  const readOnly = (): never => {
    throw new TypeError("secrets are read-only");
  };

  return new Proxy(target, {
    get(target, key, receiver) {
      if (isPassthroughKey(target, key))
        return Reflect.get(target, key, receiver);
      const name = String(key);
      if (!NAME.test(name))
        throw new Error(`Invalid secret name "${name}" (use UPPER_SNAKE_CASE)`);
      const value = values.get(name);
      if (value === undefined) throw new MissingSecretError(name, environment);
      return value;
    },
    set: readOnly,
    defineProperty: readOnly,
    deleteProperty: readOnly,
  });
}
