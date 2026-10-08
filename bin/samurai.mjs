#!/usr/bin/env node
// Quiet the framework's console logging unless the caller asked for more; the log files keep everything
process.env.SAMURAI_LOG_LEVEL ??= "warn";

// Specs are TypeScript: let this process import them. tsx is an optional peer dependency of the package
try {
  const { register } = await import("tsx/esm/api");
  register();
} catch (err) {
  if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
  process.stderr.write(
    "samurai loads TypeScript specs with tsx, which is not installed. Install it: npm install --save-dev tsx\n",
  );
  process.exit(2);
}

const { main } = await import("../dist/cli/main.js");
// Ctrl+C (or a termination signal) ends a recording or a flow run cleanly (the browser is closed, the file is complete); a second one stops at once
const interrupt = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (interrupt.signal.aborted) process.exit(130);
    interrupt.abort();
  });
}
const code = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  env: process.env,
  signal: interrupt.signal,
});
process.exit(code);
