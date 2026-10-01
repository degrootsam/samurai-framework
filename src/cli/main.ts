import { readFileSync } from "node:fs";
import {
  parseCommandLine,
  parseRunnerFlags,
  parseRunOverrides,
} from "./args.js";
import { recordSpec } from "../recorder/index.js";
import { listTests, runTests, type RunTestsOptions } from "../runner/run.js";
import { stepToSource } from "../steps/index.js";
import { ConsoleReporter } from "./console-reporter.js";
import { initProject } from "./init.js";

export const USAGE = `samurai: browser tests over WebDriver BiDi

Usage:
  samurai run [options]       Run the tests (the default command)
  samurai list [options]      List the tests without running them
  samurai record <spec>       Open a browser and record what you do into a spec file
  samurai init [folder]       Scaffold a project: config, an example test, .env.example

Options for run and list:
  --env <name>                Environment to run against (or SAMURAI_ENV)
  --file <spec>               Only this spec file; repeatable
  --grep <text>               Only tests whose full name contains the text
  --json                      Machine-readable output: JSON lines for run, one array for list

Options for run:
  --timeout <ms>              Time one test may take
  --expect-timeout <ms>       Time actions and assertions retry
  --headless                  Run the browser without a window
  --port <n>                  Browser debugging port (default 9223)

Options for record (also --env, --port, --json):
  --new <title>               Add a test with this title (creates the spec file if needed)
  --test <name|index>         Record into this test; not needed when the file has one
  --at <n>                    Insert from step n (default: after the last step)
  --url <url>                 Page to start on (default: the environment's baseURL)
  Stop with Ctrl+C or by closing the browser window.

  -h, --help                  Show this help
  -v, --version               Show the version

Exit code: 0 when every test passed, 1 when a test failed, 2 for a usage or configuration error.
Run it in the project folder, the one holding samurai.config.ts.
`;

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Whether output goes to a terminal that shows colours */
  color: boolean;
  env: Partial<NodeJS.ProcessEnv>;
  /** Aborts a recording (Ctrl+C) */
  signal?: AbortSignal;
}

function version(): string {
  const manifest = new URL("../../package.json", import.meta.url);
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string })
    .version;
}

/** The command line as `samurai` runs it. Returns the exit code */
export async function main(argv: string[], io: Io): Promise<number> {
  try {
    const first = argv[0];
    const command =
      first !== undefined && !first.startsWith("-") ? first : "run";
    const rest = command === first ? argv.slice(1) : argv;
    const { values, positionals } = parseCommandLine(rest);

    if (values.help || command === "help") {
      io.out(USAGE);
      return 0;
    }
    if (values.version) {
      io.out(`${version()}\n`);
      return 0;
    }

    if (command === "init") {
      const { written, skipped } = initProject(positionals[0] ?? ".");
      for (const file of written) io.out(`created ${file}\n`);
      for (const file of skipped) io.out(`kept    ${file} (already there)\n`);
      io.out("\nNext: install the dependencies, then `samurai run`.\n");
      return 0;
    }

    if (command === "record") {
      const file = positionals[0];
      if (!file)
        throw new Error(
          "Which spec? Usage: samurai record <spec> [--new <title>]",
        );
      const at = values.at === undefined ? undefined : Number(values.at);
      if (at !== undefined && (!Number.isInteger(at) || at < 0))
        throw new Error(`--at must be a step number, got "${values.at}"`);
      const flags = parseRunnerFlags(rest);
      const test =
        values.test === undefined
          ? undefined
          : /^\d+$/.test(values.test)
            ? Number(values.test)
            : values.test;
      let count = 0;
      const result = await recordSpec({
        ...parseRunOverrides(rest, io.env),
        file,
        ...(test !== undefined && { test }),
        ...(values.new !== undefined && { create: values.new }),
        ...(at !== undefined && { at }),
        ...(values.url !== undefined && { url: values.url }),
        ...(flags.port !== undefined && { port: flags.port }),
        ...(io.signal && { signal: io.signal }),
        onStarted: () => {
          if (!values.json)
            io.out(
              "Recording. Alt+click an element to assert on it. Press Ctrl+C or close the window to stop.\n",
            );
        },
        onEvent: (event) => {
          if (values.json) return void io.out(`${JSON.stringify(event)}\n`);
          if (event.op === "insert")
            io.out(`  + ${stepToSource(event.step)}\n`);
          else io.out(`  ~ ${stepToSource(event.step)}\n`);
          if (event.op === "insert") count++;
        },
      });
      if (!values.json) {
        io.out(
          `\nRecorded ${count} ${count === 1 ? "step" : "steps"} into "${result.test}" in ${result.file}\n`,
        );
        if (result.secrets.length > 0) {
          io.out(
            `Set ${result.secrets.map((name) => `SAMURAI_SECRET_${name}`).join(", ")} (environment variable or .env.<environment>) before running it.\n`,
          );
        }
      }
      return 0;
    }

    if (command !== "run" && command !== "list") {
      io.err(`Unknown command "${command}"\n\n${USAGE}`);
      return 2;
    }

    const flags = parseRunnerFlags(rest);
    const options: RunTestsOptions = {
      ...parseRunOverrides(rest, io.env),
      ...(flags.headless !== undefined && { headless: flags.headless }),
      ...(flags.port !== undefined && { port: flags.port }),
      ...(flags.grep !== undefined && { grep: flags.grep }),
      ...(flags.files && { files: flags.files }),
    };

    if (command === "list") {
      const tests = await listTests(options);
      if (values.json) io.out(`${JSON.stringify(tests, null, 2)}\n`);
      else
        for (const found of tests) io.out(`${found.name}\n    ${found.file}\n`);
      return 0;
    }

    const human = values.json
      ? undefined
      : new ConsoleReporter({ write: io.out, color: io.color });
    const summary = await runTests({
      ...options,
      ...(io.signal && { signal: io.signal }),
      onEvent: (event) => {
        if (values.json) io.out(`${JSON.stringify(event)}\n`);
        else human?.handle(event);
      },
    });
    return summary.status === "success" ? 0 : 1;
  } catch (err) {
    io.err(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}
