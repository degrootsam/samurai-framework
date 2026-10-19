import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { listTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
let dir: string;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "samurai-list-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(dir, "src"));
  writeFileSync(
    path.join(dir, "src/shop.spec.ts"),
    `import { describe, test } from ${API};
test("plain", async () => {});
test.skip("skipped", async () => {});
test.fixme("fixme", async () => {});
test.only("focused", async () => {});
describe.skip("Old", () => { test("inside", async () => {}); });`,
  );
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe("listTests", () => {
  it("lists every test with its modifier, and none for a plain test", async () => {
    // `forbidOnly` would refuse the `only` test; the listing is not a run
    const tests = await listTests({
      projectDir: dir,
      config: { srcDir: "./src", forbidOnly: false },
    });
    assert.deepEqual(
      tests.map((t) => [t.name, t.modifier]),
      [
        ["plain", undefined],
        ["skipped", "skip"],
        ["fixme", "fixme"],
        ["focused", "only"],
        ["Old > inside", "skip"],
      ],
    );
    assert.ok(!("modifier" in tests[0]!), "a plain test has no modifier key");
  });
});
