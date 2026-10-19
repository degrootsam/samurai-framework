import { parseArgs } from "node:util";
import {
  checkBrowserList,
  type ProjectOptions,
  type RunnerOptions,
} from "../runner/run.js";

/** `firefox` or `chrome` */
type SupportedBrowser = NonNullable<RunnerOptions["browsers"]>[number];

/** The values a command line can override for one run: the environment and the two timeouts */
type EnvAndTimeouts = Pick<
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
  browser: { type: "string", multiple: true },
  file: { type: "string", multiple: true },
  json: { type: "boolean" },
  all: { type: "boolean" },
  "allow-unsupported": { type: "boolean" },
  test: { type: "string" },
  at: { type: "string" },
  new: { type: "string" },
  url: { type: "string" },
  build: { type: "string" },
  unused: { type: "boolean" },
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

/** What `parseCommandLine` returns */
export type ParsedCommandLine = ReturnType<typeof parseCommandLine>;

/** The flag values of a command line, parsed once by the caller or here from `argv` */
export type CommandValues = ParsedCommandLine["values"];

const valuesOf = (source: string[] | CommandValues): CommandValues =>
  Array.isArray(source) ? parseCommandLine(source).values : source;

/** How the command line says tests are selected and the browser starts */
export interface RunnerFlags {
  headless?: boolean;
  port?: number;
  grep?: string;
  group?: string;
  files?: string[];
  /** `--browser`, repeated for more than one; replaces the config's `browsers` for this run */
  browsers?: SupportedBrowser[];
}

/** Reads `--headless`, `--port <n>`, `--grep <text>`, `--group <name>`, `--file <spec>` and `--browser <name>` (both repeatable) from `argv`, or from values that were parsed already */
export function parseRunnerFlags(
  source: string[] | CommandValues,
): RunnerFlags {
  const values = valuesOf(source);
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
  if (values.browser?.length) {
    checkBrowserList(values.browser, "--browser");
    flags.browsers = values.browser as SupportedBrowser[];
  }
  return flags;
}

/** Reads `--env`, `--timeout` and `--expect-timeout` from `argv` (or values parsed already); the environment falls back to SAMURAI_ENV */
export function parseRunOverrides(
  source: string[] | CommandValues,
  env: Partial<NodeJS.ProcessEnv> = {},
): EnvAndTimeouts {
  const values = valuesOf(source);
  const overrides: EnvAndTimeouts = {};
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
