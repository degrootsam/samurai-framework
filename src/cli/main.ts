import {
  parseCommandLine,
  parseRunnerFlags,
  parseRunOverrides,
} from "./args.js";
import { listTests, runTests, type RunTestsOptions } from "../runner/run.js";
import { ConsoleReporter } from "./console-reporter.js";
import { browsersCommand } from "./browsers.js";
import { flowCommand } from "./flow.js";
import { initProject } from "./init.js";
import type { Io } from "./io.js";
import { recordCommand } from "./record.js";
import { USAGE } from "./usage.js";
import { frameworkVersion } from "./version.js";

export { USAGE };

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
      io.out(`${frameworkVersion()}\n`);
      return 0;
    }

    if (command === "flow") return await flowCommand(rest, io);
    if (command === "browsers") return await browsersCommand(rest, io);

    if (command === "init") {
      const { written, skipped } = initProject(positionals[0] ?? ".");
      for (const file of written) io.out(`created ${file}\n`);
      for (const file of skipped) io.out(`kept    ${file} (already there)\n`);
      io.out(
        "\nNext: install the dependencies, then `samurai browsers install firefox`, then `samurai run`.\n",
      );
      return 0;
    }

    if (command === "record")
      return await recordCommand({ values, positionals }, io);

    if (command !== "run" && command !== "list") {
      io.err(`Unknown command "${command}"\n\n${USAGE}`);
      return 2;
    }

    const flags = parseRunnerFlags(values);
    const options: RunTestsOptions = {
      ...parseRunOverrides(values, io.env),
      ...(flags.headless !== undefined && { headless: flags.headless }),
      ...(flags.port !== undefined && { port: flags.port }),
      ...(flags.workers !== undefined && { workers: flags.workers }),
      ...(flags.retries !== undefined && { retries: flags.retries }),
      ...(flags.grep !== undefined && { grep: flags.grep }),
      ...(flags.group !== undefined && { group: flags.group }),
      ...(flags.files && { files: flags.files }),
      ...(flags.browsers && { browsers: flags.browsers }),
    };

    if (command === "list") {
      const tests = await listTests(options);
      if (values.json) io.out(`${JSON.stringify(tests, null, 2)}\n`);
      else
        for (const found of tests)
          io.out(
            `${found.name}${found.modifier ? ` [${found.modifier}${found.reason ? `: ${found.reason}` : ""}]` : ""}\n    ${found.file}\n`,
          );
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
