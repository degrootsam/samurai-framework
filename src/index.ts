import { main } from "./cli/main.js";

// Development entry (`bun run dev`): the same as `samurai run`, straight from the sources
const interrupt = new AbortController();
process.on("SIGINT", () => {
  if (interrupt.signal.aborted) process.exit(130);
  interrupt.abort();
});

process.exit(
  await main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
    env: process.env,
    signal: interrupt.signal,
  }),
);
