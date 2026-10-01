import { parseArgs } from "node:util";
import type { SamuraiTestConfig } from "../types/config.js";

export type Variables = Record<string, string | number | boolean>;

/** Values given for one run (CLI flags, SAMURAI_ENV); they beat the config */
export interface RunOverrides {
  environment?: string;
  timeout?: number;
  expectTimeout?: number;
}

/** Everything about a run that depends on the chosen environment */
export interface RunSettings {
  environment: string;
  baseURL?: string;
  /** Time (ms) one test may take */
  timeout: number;
  /** Time (ms) actions and assertions retry */
  expectTimeout: number;
  variables: Variables;
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_EXPECT_TIMEOUT = 5000;
/** The environment of a config without `environments` */
const IMPLICIT_ENVIRONMENT = "default";

export class UnknownEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownEnvironmentError";
  }
}

/** Picks the environment and applies precedence: run override > environment > project > built-in default */
export function resolveRunSettings(config: SamuraiTestConfig, overrides: RunOverrides = {}): RunSettings {
  const environments = config.environments ?? {};
  const names = Object.keys(environments);
  const available = `Available: ${names.join(", ")}`;

  let name = overrides.environment ?? config.defaultEnvironment;
  if (name === undefined) {
    if (names.length === 0) name = IMPLICIT_ENVIRONMENT;
    else if (names.length === 1) name = names[0]!;
    else throw new UnknownEnvironmentError(`No environment chosen. ${available} (use --env or set defaultEnvironment)`);
  }

  const environment = environments[name];
  if (!environment && !(names.length === 0 && name === IMPLICIT_ENVIRONMENT)) {
    throw new UnknownEnvironmentError(
      names.length === 0
        ? `Unknown environment "${name}". No environments are defined in samurai.config.ts`
        : `Unknown environment "${name}". ${available}`,
    );
  }

  const baseURL = environment?.baseURL ?? config.baseURL;
  return {
    environment: name,
    ...(baseURL !== undefined && { baseURL }),
    timeout: overrides.timeout ?? environment?.timeout ?? config.timeout ?? DEFAULT_TIMEOUT,
    expectTimeout:
      overrides.expectTimeout ?? environment?.expect?.timeout ?? config.expect?.timeout ?? DEFAULT_EXPECT_TIMEOUT,
    variables: { ...(environment?.variables ?? {}) },
  };
}

/** Reads `--env`, `--timeout` and `--expect-timeout` from `argv`; the environment falls back to SAMURAI_ENV */
export function parseRunOverrides(argv: string[], env: Partial<NodeJS.ProcessEnv> = {}): RunOverrides {
  const { values } = parseArgs({
    args: argv,
    options: {
      env: { type: "string" },
      timeout: { type: "string" },
      "expect-timeout": { type: "string" },
    },
    strict: true,
    allowPositionals: true,
  });
  const overrides: RunOverrides = {};
  const environment = values.env ?? env.SAMURAI_ENV;
  if (environment) overrides.environment = environment;
  if (values.timeout !== undefined) overrides.timeout = milliseconds("--timeout", values.timeout);
  if (values["expect-timeout"] !== undefined) {
    overrides.expectTimeout = milliseconds("--expect-timeout", values["expect-timeout"]);
  }
  return overrides;
}

function milliseconds(flag: string, raw: string): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} must be a whole number of milliseconds, got "${raw}"`);
  }
  return value;
}

let active: RunSettings | undefined;

/** Makes `settings` the run's settings; `undefined` ends the run (tests use this to reset) */
export function setRunSettings(settings: RunSettings | undefined): void {
  active = settings;
}

/** The active run's settings, or undefined outside a run (unit and browser tests) */
export function peekRunSettings(): RunSettings | undefined {
  return active;
}

export function getRunSettings(): RunSettings {
  if (!active) throw new Error("No test run is active; run settings are set when the runner starts");
  return active;
}
