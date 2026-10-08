import { parseArgs } from "node:util";
import type { ProjectOptions } from "../runner/run.js";

/** The values a command line can override for one run */
type RunOverrides = Pick<
  ProjectOptions,
  "environment" | "timeout" | "expectTimeout"
>;

const FLAGS = {
  env: { type: "string" },
  timeout: { type: "string" },
  "expect-timeout": { type: "string" },
  headless: { type: "boolean" },
  port: { type: "string" },
  grep: { type: "string" },
  group: { type: "string" },
  file: { type: "string", multiple: true },
  json: { type: "boolean" },
  test: { type: "string" },
  at: { type: "string" },
  new: { type: "string" },
  url: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** Flags and positional arguments of a command line; an unknown flag is an error */
export function parseCommandLine(argv: string[]) {
  return parseArgs({
    args: argv,
    options: FLAGS,
    strict: true,
    allowNegative: true,
    allowPositionals: true,
  });
}

function parseFlags(argv: string[]) {
  return parseCommandLine(argv).values;
}

/** How the command line says tests are selected and the browser starts */
export interface RunnerFlags {
  headless?: boolean;
  port?: number;
  grep?: string;
  group?: string;
  files?: string[];
}

/** Reads `--headless`, `--port <n>`, `--grep <text>`, `--group <name>` and `--file <spec>` (repeatable) from `argv` */
export function parseRunnerFlags(argv: string[]): RunnerFlags {
  const values = parseFlags(argv);
  const flags: RunnerFlags = {};
  if (values.headless !== undefined) flags.headless = values.headless;
  if (values.port !== undefined) {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        `--port must be a port number between 1 and 65535, got "${values.port}"`,
      );
    }
    flags.port = port;
  }
  if (values.grep !== undefined) flags.grep = values.grep;
  if (values.group !== undefined) flags.group = values.group;
  if (values.file?.length) flags.files = values.file;
  return flags;
}

/** Reads `--env`, `--timeout` and `--expect-timeout` from `argv`; the environment falls back to SAMURAI_ENV */
export function parseRunOverrides(
  argv: string[],
  env: Partial<NodeJS.ProcessEnv> = {},
): RunOverrides {
  const values = parseFlags(argv);
  const overrides: RunOverrides = {};
  const environment = values.env ?? env.SAMURAI_ENV;
  if (environment) overrides.environment = environment;
  if (values.timeout !== undefined)
    overrides.timeout = milliseconds("--timeout", values.timeout);
  if (values["expect-timeout"] !== undefined) {
    overrides.expectTimeout = milliseconds(
      "--expect-timeout",
      values["expect-timeout"],
    );
  }
  return overrides;
}

function milliseconds(flag: string, raw: string): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value < 0) {
    throw new Error(
      `${flag} must be a whole number of milliseconds, got "${raw}"`,
    );
  }
  return value;
}
