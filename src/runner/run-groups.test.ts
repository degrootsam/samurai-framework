import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { SamuraiTestConfig } from "../types/config.js";
import { listGroups, listTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
let dir: string;

const spec = (body: string) =>
  `import { describe, test } from ${API};\n${body}`;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "samurai-groups-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(dir, "src/checkout"), { recursive: true });
  writeFileSync(
    path.join(dir, "src/login.spec.ts"),
    spec(
      `test("works", async () => {});\ntest("fails nicely", async () => {});`,
    ),
  );
  writeFileSync(
    path.join(dir, "src/checkout/cart.spec.ts"),
    spec(`describe("Cart", () => { test("adds", async () => {}); });`),
  );
});

after(() => rmSync(dir, { recursive: true, force: true }));

const config: SamuraiTestConfig = {
  groups: [
    { name: "checkout", src: "./src/checkout" },
    {
      name: "smoke",
      tests: [
        { file: "login.spec.ts", title: "works" },
        { file: "login.spec.ts", title: "gone" },
      ],
    },
  ],
};
const names = (tests: { name: string }[]) => tests.map((t) => t.name).sort();

describe("groups through the runner", () => {
  it("a pattern group keeps only the tests below its src", async () => {
    const tests = await listTests({
      projectDir: dir,
      config,
      group: "checkout",
    });
    assert.deepEqual(names(tests), ["Cart > adds"]);
  });

  it("a picked group keeps only the picked tests that exist", async () => {
    const tests = await listTests({ projectDir: dir, config, group: "smoke" });
    assert.deepEqual(names(tests), ["works"]);
  });

  it("combines with grep, and without a group every test is listed", async () => {
    assert.deepEqual(
      names(
        await listTests({
          projectDir: dir,
          config,
          group: "smoke",
          grep: "nicely",
        }),
      ),
      [],
    );
    assert.deepEqual(names(await listTests({ projectDir: dir, config })), [
      "Cart > adds",
      "fails nicely",
      "works",
    ]);
  });

  it("an unknown group throws and names the groups", async () => {
    await assert.rejects(
      listTests({ projectDir: dir, config, group: "nope" }),
      { message: 'Unknown group "nope". Groups: checkout, smoke.' },
    );
    await assert.rejects(
      listTests({ projectDir: dir, config: {}, group: "nope" }),
      /Unknown group "nope"/,
    );
  });

  it("listGroups resolves the groups and reports missing picked tests", async () => {
    const groups = await listGroups({ projectDir: dir, config });
    assert.deepEqual(groups, [
      {
        name: "checkout",
        kind: "pattern",
        pattern: "./src/checkout",
        testIds: ["checkout/cart.spec.ts::Cart > adds"],
        missing: [],
      },
      {
        name: "smoke",
        kind: "picked",
        testIds: ["login.spec.ts::works"],
        missing: [{ file: "login.spec.ts", title: "gone" }],
      },
    ]);
  });
});
