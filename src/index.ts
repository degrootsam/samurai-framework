import { parseRunnerFlags, parseRunOverrides } from "./config/run-settings.js";
import { runTests } from "./runner/run.js";

const argv = process.argv.slice(2);
const flags = parseRunnerFlags(argv);
const summary = await runTests({
  ...parseRunOverrides(argv, process.env),
  ...(flags.headless !== undefined && { headless: flags.headless }),
  ...(flags.port !== undefined && { port: flags.port }),
  ...(flags.grep !== undefined && { grep: flags.grep }),
  ...(flags.files && { files: flags.files }),
});

process.exit(summary.status === "success" ? 0 : 1);
