import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  findGroup,
  resolveGroup,
  resolveGroups,
  testId,
  type GroupTest,
} from "./groups.js";

const project = path.resolve("/work/shop");
const srcDir = path.join(project, "src");

const tests: GroupTest[] = [
  { file: "login.spec.ts", name: "Login > works" },
  { file: "checkout/cart.spec.ts", name: "Cart > adds" },
  { file: "checkout/coupons.spec.ts", name: "Coupons > applies" },
  { file: "checkout/helpers.ts", name: "not a spec" },
];

describe("testId", () => {
  it("is file::name with posix separators", () => {
    assert.equal(
      testId("checkout/cart.spec.ts", "Cart > adds"),
      "checkout/cart.spec.ts::Cart > adds",
    );
    assert.equal(
      testId("checkout\\cart.spec.ts", "A"),
      "checkout/cart.spec.ts::A",
    );
  });
});

describe("resolveGroup", () => {
  it("by pattern: testMatch against the path below srcDir, default **/*.spec.ts", () => {
    const all = resolveGroup({ name: "all" }, tests, project, srcDir);
    assert.equal(all.kind, "pattern");
    assert.equal(all.pattern, "**/*.spec.ts");
    assert.deepEqual(all.testIds, [
      "login.spec.ts::Login > works",
      "checkout/cart.spec.ts::Cart > adds",
      "checkout/coupons.spec.ts::Coupons > applies",
    ]);
    const some = resolveGroup(
      { name: "c", testMatch: "checkout/c*.spec.ts" },
      tests,
      project,
      srcDir,
    );
    assert.deepEqual(some.testIds, [
      "checkout/cart.spec.ts::Cart > adds",
      "checkout/coupons.spec.ts::Coupons > applies",
    ]);
  });

  it("by src below srcDir: only tests under that folder", () => {
    const group = resolveGroup(
      { name: "checkout", src: "./src/checkout" },
      tests,
      project,
      srcDir,
    );
    assert.equal(group.pattern, "./src/checkout");
    assert.deepEqual(group.testIds, [
      "checkout/cart.spec.ts::Cart > adds",
      "checkout/coupons.spec.ts::Coupons > applies",
    ]);
  });

  it("picked tests override src and testMatch", () => {
    const group = resolveGroup(
      {
        name: "smoke",
        src: "./src/checkout",
        testMatch: "nothing",
        tests: [{ file: "login.spec.ts", title: "Login > works" }],
      },
      tests,
      project,
      srcDir,
    );
    assert.equal(group.kind, "picked");
    assert.deepEqual(group.testIds, ["login.spec.ts::Login > works"]);
    assert.deepEqual(group.missing, []);
  });

  it("a picked test that no longer exists is missing", () => {
    const group = resolveGroup(
      {
        name: "smoke",
        tests: [
          { file: "login.spec.ts", title: "Login > works" },
          { file: "login.spec.ts", title: "Login > gone" },
        ],
      },
      tests,
      project,
      srcDir,
    );
    assert.deepEqual(group.testIds, ["login.spec.ts::Login > works"]);
    assert.deepEqual(group.missing, [
      { file: "login.spec.ts", title: "Login > gone" },
    ]);
  });

  it("a pattern matching nothing holds no tests", () => {
    const group = resolveGroup(
      { name: "none", testMatch: "**/*.e2e.ts" },
      tests,
      project,
      srcDir,
    );
    assert.deepEqual(group.testIds, []);
    assert.deepEqual(group.missing, []);
  });

  it("windows-style separators in test files and picked files", () => {
    const win: GroupTest[] = [
      { file: "checkout\\cart.spec.ts", name: "Cart > adds" },
    ];
    const byPattern = resolveGroup(
      { name: "c", testMatch: "checkout/*.spec.ts" },
      win,
      project,
      srcDir,
    );
    assert.deepEqual(byPattern.testIds, ["checkout/cart.spec.ts::Cart > adds"]);
    const picked = resolveGroup(
      {
        name: "p",
        tests: [{ file: "checkout\\cart.spec.ts", title: "Cart > adds" }],
      },
      win,
      project,
      srcDir,
    );
    assert.deepEqual(picked.testIds, ["checkout/cart.spec.ts::Cart > adds"]);
  });
});

describe("resolveGroups and findGroup", () => {
  it("resolves every group; no groups key means none", () => {
    assert.deepEqual(resolveGroups({}, tests, project, srcDir), []);
    const groups = resolveGroups(
      { groups: [{ name: "a" }, { name: "b", src: "./src/checkout" }] },
      tests,
      project,
      srcDir,
    );
    assert.deepEqual(
      groups.map((g) => g.name),
      ["a", "b"],
    );
  });

  it("an unknown group names the groups there are", () => {
    const groups = [{ name: "a" }, { name: "b" }];
    assert.equal(findGroup(groups, "b"), groups[1]);
    assert.throws(() => findGroup(groups, "c"), {
      message: 'Unknown group "c". Groups: a, b.',
    });
    assert.throws(() => findGroup([], "c"), /No groups are configured/);
  });
});
