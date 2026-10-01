import { loadConfig } from "./config/config.js";
import { parseRunOverrides } from "./config/run-settings.js";
import { prepareRun } from "./runner/prepare-run.js";
import TestRunner from "./runner/test-runner.js";

const run = prepareRun(await loadConfig(), parseRunOverrides(process.argv.slice(2), process.env));
const runner = await TestRunner.init(run);
await runner.start();

process.exit();
