// Prints the arguments `npm run test:browser` hands to the test runner after its own options: the browser test
// files, all of them or those of one shard (`SAMURAI_TEST_SHARD=n/total`).
//
// Node's own `--test-shard` deals the files out by position, so the slow ones (the runner tests start whole
// projects) piled up in some shards. Here the files are split by how long they took on the browser under test
// (`SAMURAI_TEST_BROWSER`), from `browser-timings.json`: longest first, each into the shard with the least
// time so far. A file that is not in the timings yet counts as the median one.
//
// With `SAMURAI_TEST_TIMINGS=<file>` the run also writes each file's duration there (`browser-timings-reporter.mjs`)
// next to the usual spec output.
//
// Refreshing the timings, after files were added or got much slower or faster: CI uploads the durations of every
// shard on main as the `browser-timings-<browser>-<shard>` artifacts, so
//   gh run download <run id> -p 'browser-timings-*' -D <folder>
//   node scripts/browser-shards.mjs --update <folder>
// (or a local `SAMURAI_TEST_TIMINGS=result/timings.json npm run test:browser` and `--update result`), then commit
// `scripts/browser-timings.json`.
import {
  globSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TIMINGS = fileURLToPath(new URL("browser-timings.json", import.meta.url));
const PATTERN = "src/**/*.browser-test.ts";
const BROWSERS = ["firefox", "chrome"];

/** The shard of `SAMURAI_TEST_SHARD`, or undefined for all files */
function parseShard(value) {
  if (!value) return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || index < 1 || index > total)
    throw new Error(
      `SAMURAI_TEST_SHARD must be <n>/<total> with 1 <= n <= total, got "${value}"`,
    );
  return { index, total };
}

/** Splits `files` over `total` shards by their duration in `seconds`: longest first, into the shard with least so far */
function split(files, seconds, total) {
  const known = files
    .map((file) => seconds[file])
    .filter((value) => value !== undefined)
    .sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weight = (file) => seconds[file] ?? fallback;
  const shards = Array.from({ length: total }, () => ({ time: 0, files: [] }));
  const longestFirst = [...files].sort(
    (a, b) => weight(b) - weight(a) || a.localeCompare(b),
  );
  for (const file of longestFirst) {
    const emptiest = shards.reduce((min, shard) =>
      shard.time < min.time ? shard : min,
    );
    emptiest.time += weight(file);
    emptiest.files.push(file);
  }
  return shards.map((shard) => shard.files.sort());
}

/** Seconds per file on `browser`, from the checked-in timings */
function timingsOf(browser) {
  const all = JSON.parse(readFileSync(TIMINGS, "utf8"));
  return Object.fromEntries(
    Object.entries(all).flatMap(([file, times]) =>
      times[browser] === undefined ? [] : [[file, times[browser]]],
    ),
  );
}

/** Merges the reporter's files found under `folder` into the timings; files that no longer exist are dropped */
function update(folder) {
  const files = new Set(globSync(PATTERN));
  const old = JSON.parse(readFileSync(TIMINGS, "utf8"));
  const next = {};
  for (const file of [...files].sort()) if (old[file]) next[file] = old[file];
  const reports = readdirSync(folder, { recursive: true }).filter((name) =>
    name.endsWith(".json"),
  );
  for (const name of reports) {
    const report = JSON.parse(readFileSync(path.join(folder, name), "utf8"));
    if (!BROWSERS.includes(report.browser) || !report.files) continue;
    for (const [file, seconds] of Object.entries(report.files))
      if (files.has(file)) (next[file] ??= {})[report.browser] = seconds;
  }
  writeFileSync(TIMINGS, `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    `${path.relative(process.cwd(), TIMINGS)}: ${Object.keys(next).length} files from ${reports.length} reports`,
  );
}

if (process.argv[2] === "--update") {
  if (!process.argv[3])
    throw new Error("usage: browser-shards.mjs --update <folder>");
  update(process.argv[3]);
} else {
  const browser = process.env.SAMURAI_TEST_BROWSER || "firefox";
  const shard = parseShard(process.env.SAMURAI_TEST_SHARD);
  const files = globSync(PATTERN).sort();
  const chosen = shard
    ? split(files, timingsOf(browser), shard.total)[shard.index - 1]
    : files;
  const destination = process.env.SAMURAI_TEST_TIMINGS;
  // The runner does not make the folder of a reporter destination
  if (destination) mkdirSync(path.dirname(destination), { recursive: true });
  const reporters = destination
    ? [
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        "--test-reporter=./scripts/browser-timings-reporter.mjs",
        `--test-reporter-destination=${destination}`,
      ]
    : [];
  console.log([...reporters, ...chosen].join(" "));
}
