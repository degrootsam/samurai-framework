#!/usr/bin/env node
// Quiet the framework's console logging unless the caller asked for more; the log files keep everything
process.env.SAMURAI_LOG_LEVEL ??= "warn";

// Specs are TypeScript: let this process import them
const { register } = await import("tsx/esm/api");
register();

const { main } = await import("../dist/cli/main.js");
// Ctrl+C ends a recording cleanly (the browser is closed, the file is complete); a second one stops at once
const interrupt = new AbortController();
process.on("SIGINT", () => {
  if (interrupt.signal.aborted) process.exit(130);
  interrupt.abort();
});
const code = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  env: process.env,
  signal: interrupt.signal,
});
process.exit(code);
