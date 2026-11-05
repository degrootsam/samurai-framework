import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserConfig } from "../testing/test-browser.js";
import { runTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

/** Each test appends its name to `ran.log`, so a test that runs twice (or not at all) shows */
const spec = (names: string[], head = "") => `
import { appendFileSync } from "node:fs";
import { test } from ${API};
${head}
${names
  .map(
    (n) => `test(${JSON.stringify(n)}, async ({ page }) => {
  appendFileSync(process.env.RAN_LOG, ${JSON.stringify(n)} + "\\n");
  await page.navigateTo("data:text/html,<h1>Hi</h1>");
});`,
  )
  .join("\n")}
`;

function project(files: Record<string, string>, config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-shard-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({ srcDir: "./specs", timeout: 30000, forbidOnly: false, ...browserConfig(), ...config })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  for (const [name, source] of Object.entries(files))
    writeFileSync(path.join(dir, "specs", name), source);
  writeFileSync(path.join(dir, "ran.log"), "");
  process.env.RAN_LOG = path.join(dir, "ran.log");
  return {
    dir,
    ran: () =>
      readFileSync(path.join(dir, "ran.log"), "utf8")
        .split("\n")
        .filter(Boolean),
  };
}

test(
  "two shards together run every test exactly once, whole files each",
  { timeout: 120000 },
  async () => {
    const { dir, ran } = project({
      "a.spec.ts": spec(["a1", "a2"]),
      "b.spec.ts": spec(["b1", "b2", "b3"]),
      "c.spec.ts": spec(["c1"]),
    });
    const shards: string[][] = [];
    for (const current of [1, 2]) {
      const before = ran().length;
      const summary = await runTests({
        projectDir: dir,
        dataDir: path.join(dir, "data"),
        headless: true,
        port: 9552,
        workers: 2,
        reportPath: false,
        shard: { current, total: 2 },
      });
      assert.equal(summary.status, "success");
      assert.deepEqual(summary.shard, { current, total: 2 });
      const mine = ran().slice(before);
      assert.deepEqual(
        mine.sort(),
        summary.tests.map((t) => ("name" in t ? t.name : "")).sort(),
      );
      shards.push(mine);
    }
    assert.deepEqual(shards.flat().sort(), [
      "a1",
      "a2",
      "b1",
      "b2",
      "b3",
      "c1",
    ]);
    for (const file of ["a", "b", "c"])
      assert.equal(
        shards.filter((names) => names.some((n) => n.startsWith(file))).length,
        1,
        `${file}.spec.ts is in one shard`,
      );
  },
);

test(
  "a shard keeps a serial block whole even with fullyParallel, and an empty shard succeeds",
  { timeout: 120000 },
  async () => {
    const { dir, ran } = project(
      {
        "a.spec.ts": spec(["s1", "s2", "s3"]),
      },
      { fullyParallel: true },
    );
    // Put the three tests in one serial block
    const file = path.join(dir, "specs/a.spec.ts");
    writeFileSync(
      file,
      readFileSync(file, "utf8")
        .replace(/\ntest\(/, '\ntest.describe.serial("block", () => {\ntest(')
        .replace(/\s*$/, "\n});\n"),
    );
    const options = {
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9556,
      reportPath: false as const,
    };
    const first = await runTests({
      ...options,
      shard: { current: 1, total: 2 },
    });
    assert.equal(first.status, "success");
    assert.equal(first.tests.length, 3);
    const second = await runTests({
      ...options,
      shard: { current: 2, total: 2 },
    });
    assert.deepEqual(second.tests, []);
    assert.equal(second.status, "success");
    assert.deepEqual(ran(), ["s1", "s2", "s3"]);
  },
);
