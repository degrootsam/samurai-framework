import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RegisteredTestCase } from "../types/test.js";
import { parseShard, shardGroupOf, shardTests } from "./shard.js";
import { newSuite } from "./suite.js";

const make = (file: string, name: string, suite = newSuite()) =>
  ({ file, name, titlePath: [name], suite }) as unknown as RegisteredTestCase;

/** `files` files, the i-th holding `sizes[i % sizes.length]` tests */
function project(files: number, sizes: number[]): RegisteredTestCase[] {
  return Array.from({ length: files }, (_, f) =>
    Array.from({ length: sizes[f % sizes.length]! }, (_, t) =>
      make(`/p/f${f}.spec.ts`, `t${t}`),
    ),
  ).flat();
}

const byFile = (test: RegisteredTestCase) => test.file;
const each = (test: RegisteredTestCase) => `${test.file}::${test.name}`;

describe("parseShard", () => {
  it("reads current/total and the object form", () => {
    assert.deepEqual(parseShard("2/4", "--shard"), { current: 2, total: 4 });
    assert.deepEqual(parseShard(" 1 / 1 ", "--shard"), {
      current: 1,
      total: 1,
    });
    assert.deepEqual(parseShard({ current: 3, total: 3 }, "shard"), {
      current: 3,
      total: 3,
    });
  });

  it("names the source and the rule", () => {
    for (const bad of [
      "0/3",
      "4/3",
      "1/0",
      "a/b",
      "1",
      "1/2/3",
      "-1/2",
      "1.5/2",
      "",
    ])
      assert.throws(
        () => parseShard(bad, "--shard"),
        (error: Error) =>
          error.message ===
          `--shard: expected current/total with 1 <= current <= total, got "${bad}"`,
        bad,
      );
    assert.throws(
      () => parseShard({ current: 5, total: 2 }, "shard"),
      /^Error: shard: expected current\/total with 1 <= current <= total, got \{"current":5,"total":2\}$/,
    );
    assert.throws(
      () => parseShard(undefined, "shard"),
      /^Error: shard: expected/,
    );
  });
});

describe("shardTests", () => {
  it("makes disjoint shards that together hold every test once, in the same order, for many sizes", () => {
    for (const files of [0, 1, 2, 3, 7, 12]) {
      for (const sizes of [[1], [3], [1, 4, 2], [5, 1]]) {
        const tests = project(files, sizes);
        for (const total of [1, 2, 3, 4, 5, 9]) {
          for (const group of [byFile, each]) {
            const parts = Array.from({ length: total }, (_, i) =>
              shardTests(tests, { current: i + 1, total }, group),
            );
            const seen = parts.flat();
            assert.equal(
              seen.length,
              tests.length,
              `${files} files ${sizes} / ${total}`,
            );
            assert.equal(new Set(seen).size, tests.length, "disjoint");
            assert.deepEqual(
              [...seen].sort((a, b) => tests.indexOf(a) - tests.indexOf(b)),
              tests,
              "complete",
            );
            for (const part of parts)
              assert.deepEqual(
                part,
                tests.filter((t) => part.includes(t)),
                "order kept",
              );
          }
        }
      }
    }
  });

  it("is the same every time", () => {
    const tests = project(9, [2, 3]);
    const again = project(9, [2, 3]);
    for (let current = 1; current <= 4; current++)
      assert.deepEqual(
        shardTests(tests, { current, total: 4 }, byFile).map(each),
        shardTests(again, { current, total: 4 }, byFile).map(each),
      );
  });

  it("keeps the shards within one test of each other when every test is its own group", () => {
    const tests = project(5, [3]);
    const counts = [1, 2, 3, 4].map(
      (current) => shardTests(tests, { current, total: 4 }, each).length,
    );
    assert.deepEqual(counts, [4, 4, 4, 3]);
  });

  it("never splits a file, and balances whole files", () => {
    const tests = project(6, [4]);
    const parts = [1, 2, 3].map((current) =>
      shardTests(tests, { current, total: 3 }, byFile),
    );
    assert.deepEqual(
      parts.map((p) => p.length),
      [8, 8, 8],
    );
    for (const part of parts)
      assert.equal(new Set(part.map((t) => t.file)).size, 2);
  });

  it("leaves a shard empty when there are fewer groups than shards", () => {
    const tests = project(1, [3]);
    assert.equal(shardTests(tests, { current: 1, total: 2 }, byFile).length, 3);
    assert.equal(shardTests(tests, { current: 2, total: 2 }, byFile).length, 0);
    assert.deepEqual(shardTests([], { current: 1, total: 3 }, byFile), []);
  });
});

describe("shardGroupOf", () => {
  it("is the file, a serial block, or the test itself", () => {
    const file = "/p/a.spec.ts";
    const plain = make(file, "x");
    assert.equal(shardGroupOf(plain, undefined), `file:${file}`);
    assert.equal(shardGroupOf(plain, false), `file:${file}`);
    assert.equal(shardGroupOf(plain, true), `test:${file}::x`);

    const parallel = make(
      file,
      "y",
      newSuite("p", newSuite(), undefined, undefined, "parallel"),
    );
    assert.equal(shardGroupOf(parallel, undefined), `test:${file}::y`);

    const serial = newSuite("s", newSuite(), undefined, undefined, "serial");
    assert.equal(
      shardGroupOf(make(file, "z", serial), true),
      `serial:${file}::s`,
    );
    assert.equal(
      shardGroupOf(make(file, "z", serial), true),
      shardGroupOf(make(file, "w", serial), true),
    );
  });
});
