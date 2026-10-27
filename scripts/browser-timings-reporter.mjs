// A test reporter that writes how long each test file took, for `browser-shards.mjs --update`:
// `{ "browser": "firefox", "files": { "src/....browser-test.ts": 12.3 } }`.
//
// The browser tests run one file at a time, so a file's time is from the end of the file before it to its own end
// (its `test:summary`): that counts its process start, browser launch and exit too, which is what a shard spends
// on it. The file of the other events is where `test()` was called, which for `onlyOn` and `skipOn` is
// test-browser.ts, so they are no use here.
import path from "node:path";
import { performance } from "node:perf_hooks";

export default async function* browserTimings(source) {
  const files = {};
  let previous = performance.now();
  for await (const event of source) {
    if (event.type !== "test:summary" || !event.data.file) continue;
    const now = performance.now();
    const file = path.relative(process.cwd(), event.data.file);
    files[file] = Math.round((now - previous) / 100) / 10;
    previous = now;
  }
  const browser = process.env.SAMURAI_TEST_BROWSER || "firefox";
  yield `${JSON.stringify({ browser, files }, null, 2)}\n`;
}
