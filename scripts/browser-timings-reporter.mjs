// A test reporter that writes how long each test file took, for `browser-shards.mjs --update`:
// `{ "browser": "firefox", "files": { "src/....browser-test.ts": 12.3 } }`.
//
// The browser tests run one file at a time, so a file's time is from the last event of the file before it to its
// own last one: that counts its process start and browser launch too, which is what a shard spends on it.
import path from "node:path";
import { performance } from "node:perf_hooks";

export default async function* browserTimings(source) {
  const start = performance.now();
  const lastSeen = new Map();
  for await (const event of source) {
    const file = event.data?.file;
    if (file)
      lastSeen.set(path.relative(process.cwd(), file), performance.now());
  }
  const files = {};
  let previous = start;
  for (const [file, at] of [...lastSeen].sort((a, b) => a[1] - b[1])) {
    files[file] = Math.round((at - previous) / 100) / 10;
    previous = at;
  }
  const browser = process.env.SAMURAI_TEST_BROWSER || "firefox";
  yield `${JSON.stringify({ browser, files }, null, 2)}\n`;
}
