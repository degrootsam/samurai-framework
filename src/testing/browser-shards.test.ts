import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SCRIPT = path.resolve("scripts/browser-shards.mjs");

/** The files `npm run test:browser` would run with this env */
function filesOf(env: Record<string, string>) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, SAMURAI_TEST_SHARD: "", ...env },
    encoding: "utf8",
  });
  return { ...result, files: result.stdout.split(/\s+/).filter(Boolean) };
}

describe("browser-shards", () => {
  const all = globSync("src/**/*.browser-test.ts").sort();

  it("runs every browser test file without a shard", () => {
    assert.deepEqual(filesOf({}).files, all);
  });

  for (const browser of ["firefox", "chrome"])
    it(`puts each file in exactly one of five shards on ${browser}`, () => {
      const shards = [1, 2, 3, 4, 5].map(
        (n) =>
          filesOf({
            SAMURAI_TEST_BROWSER: browser,
            SAMURAI_TEST_SHARD: `${n}/5`,
          }).files,
      );
      assert.ok(shards.every((files) => files.length > 0));
      assert.deepEqual(shards.flat().sort(), all);
    });

  it("refuses a shard outside its total", () => {
    const result = filesOf({ SAMURAI_TEST_SHARD: "6/5" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SAMURAI_TEST_SHARD must be <n>\/<total>/);
  });

  it("puts the timings reporter before the files when asked", () => {
    const { files } = filesOf({ SAMURAI_TEST_TIMINGS: "result/t.json" });
    assert.equal(files[files.length - 1], all[all.length - 1]);
    assert.ok(
      files.includes("--test-reporter-destination=result/t.json") &&
        files.indexOf("--test-reporter=spec") < files.indexOf(all[0]!),
    );
  });
});
