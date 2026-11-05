import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { runTests, type RunEvent, type TestSummary } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
let dir: string;

/** Skipped tests need no browser, so these runs open none */
const skips = (names: string[]) =>
  `import { test } from ${API};\n${names.map((n) => `test.skip(${JSON.stringify(n)}, async () => {});`).join("\n")}`;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "samurai-shard-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src/a.spec.ts"), skips(["a1", "a2", "a3"]));
  writeFileSync(path.join(dir, "src/b.spec.ts"), skips(["b1", "b2"]));
  writeFileSync(
    path.join(dir, "src/c.spec.ts"),
    `import { test } from ${API};
test.describe.serial("block", () => {
  test.skip("c1", async () => {});
  test.skip("c2", async () => {});
});
test.skip("c3", async () => {});`,
  );
  writeFileSync(path.join(dir, "src/d.spec.ts"), skips(["d1"]));
});

after(() => rmSync(dir, { recursive: true, force: true }));

const run = (current: number, total: number, config = {}) => {
  const events: RunEvent[] = [];
  const summary = runTests({
    projectDir: dir,
    config,
    reportPath: false,
    shard: { current, total },
    onEvent: (event) => events.push(event),
  });
  return summary.then((s) => ({ summary: s, events }));
};

const namesOf = (summary: TestSummary) =>
  summary.tests.map((t) => ("name" in t ? t.name : ""));

describe("runTests with a shard", () => {
  it("runs disjoint slices that together hold every test once, and the report names the shard", async () => {
    const all: string[] = [];
    for (const current of [1, 2, 3]) {
      const { summary, events } = await run(current, 3);
      assert.equal(summary.status, "success");
      assert.deepEqual(summary.shard, { current, total: 3 });
      const start = events.find((e) => e.type === "run-start");
      assert.deepEqual(start?.type === "run-start" && start.shard, {
        current,
        total: 3,
      });
      all.push(...namesOf(summary));
    }
    assert.deepEqual(
      [...all].sort(),
      [
        "a1",
        "a2",
        "a3",
        "b1",
        "b2",
        "block > c1",
        "block > c2",
        "c3",
        "d1",
      ].sort(),
    );
  });

  it("keeps the tests of a file together, and a serial block whole", async () => {
    const shards: string[][] = [];
    for (const current of [1, 2, 3, 4]) {
      const { summary } = await run(current, 4);
      shards.push(namesOf(summary));
    }
    for (const group of [
      ["a1", "a2", "a3"],
      ["b1", "b2"],
      ["block > c1", "block > c2"],
    ]) {
      const holding = shards.filter((names) =>
        group.some((n) => names.includes(n)),
      );
      assert.equal(holding.length, 1, `${group[0]} is in one shard`);
      assert.ok(group.every((n) => holding[0]!.includes(n)));
    }
  });

  it("splits single tests with fullyParallel, but not a serial block", async () => {
    const shards: string[][] = [];
    for (const current of [1, 2, 3]) {
      const { summary } = await run(current, 3, { fullyParallel: true });
      shards.push(namesOf(summary));
    }
    assert.equal(shards.flat().length, 9);
    assert.ok(
      shards.some(
        (names) => names.some((n) => n.startsWith("a")) && names.length < 5,
      ),
    );
    assert.equal(
      shards.filter(
        (names) =>
          names.includes("block > c1") !== names.includes("block > c2"),
      ).length,
      0,
    );
    assert.ok(new Set(shards.map((s) => s.join())).size === 3);
  });

  it("succeeds with no tests when there are more shards than groups", async () => {
    const { summary } = await run(20, 20);
    assert.equal(summary.status, "success");
    assert.deepEqual(summary.tests, []);
    assert.deepEqual(summary.shard, { current: 20, total: 20 });
  });

  it("refuses a shard that is not current/total", async () => {
    await assert.rejects(
      run(0, 3),
      /^Error: shard: expected current\/total with 1 <= current <= total, got \{"current":0,"total":3\}$/,
    );
  });
});
