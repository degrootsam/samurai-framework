import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { listGroups, listTests } from "./run.js";

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
test.fixme("fixme", { reason: "flaky on CI" }, async () => {});
test.only("focused", async () => {});
describe.skip("Old", { reason: "replaced" }, () => { test("inside", async () => {}); });`,
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
    assert.deepEqual(
      tests.map((t) => t.reason),
      [undefined, undefined, "flaky on CI", undefined, "replaced"],
    );
    assert.ok(!("reason" in tests[1]!), "no reason key without one");
  });

  it("gives each test the id its groups use, and its file relative to srcDir", async () => {
    const options = {
      projectDir: dir,
      config: {
        srcDir: "./src",
        forbidOnly: false,
        groups: [{ name: "all" }],
      },
    };
    const tests = await listTests(options);
    assert.equal(tests[0]!.relativeFile, "shop.spec.ts");
    assert.equal(tests[0]!.id, "shop.spec.ts::plain");
    assert.deepEqual(Object.keys(tests[0]!), [
      "id",
      "name",
      "file",
      "relativeFile",
    ]);
    const [all] = await listGroups(options);
    assert.deepEqual(
      all!.testIds,
      tests.map((t) => t.id),
    );
  });

  it("ids match groups when the project folder is a symlink", async () => {
    const holder = mkdtempSync(path.join(tmpdir(), "samurai-list-link-"));
    try {
      const link = path.join(holder, "link");
      symlinkSync(dir, link);
      const options = {
        projectDir: link,
        config: {
          srcDir: "./src",
          forbidOnly: false,
          groups: [{ name: "all" }],
        },
      };
      const tests = await listTests(options);
      const [all] = await listGroups(options);
      assert.equal(tests[0]!.relativeFile, "shop.spec.ts");
      assert.deepEqual(
        tests.map((t) => t.id),
        all!.testIds,
      );
    } finally {
      rmSync(holder, { recursive: true, force: true });
    }
  });
});

describe("listTests inputs and outputs", () => {
  let ioDir: string;
  before(() => {
    ioDir = mkdtempSync(path.join(tmpdir(), "samurai-list-io-"));
    writeFileSync(path.join(ioDir, "package.json"), '{"type":"module"}');
    mkdirSync(path.join(ioDir, "src"));
    writeFileSync(
      path.join(ioDir, "src/io.spec.ts"),
      `import { test } from ${API};
test("plain", async () => {});
test("io", { inputs: { a: "1", b: "2" }, outputs: ["o"] }, async () => {});`,
    );
  });
  after(() => rmSync(ioDir, { recursive: true, force: true }));

  it("lists inputs in declaration order and outputs, absent for a plain test", async () => {
    const tests = await listTests({
      projectDir: ioDir,
      config: { srcDir: "./src" },
    });
    assert.deepEqual(tests[1]!.inputs, [
      { name: "a", default: "1" },
      { name: "b", default: "2" },
    ]);
    assert.deepEqual(tests[1]!.outputs, ["o"]);
    assert.ok(!("inputs" in tests[0]!) && !("outputs" in tests[0]!));
  });
});
