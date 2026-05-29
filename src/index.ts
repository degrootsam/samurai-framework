import TestRunner from "./runner/test-runner.js";

const t = await TestRunner.init();
await t.run();

process.exit();
