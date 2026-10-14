import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pickTest, resultSecrets, toolbarOptions } from "./session.js";

const tests = [
  { name: "Login > signs in" },
  { name: "Login > signs out" },
  { name: "Cart > adds an item" },
];

describe("pickTest", () => {
  it("takes the only test without a selector, and asks otherwise", () => {
    assert.equal(pickTest([{ name: "a" }], undefined), 0);
    assert.throws(
      () => pickTest(tests, undefined),
      /choose one with --test[\s\S]*Cart > adds an item/,
    );
  });

  it("takes an index", () => {
    assert.equal(pickTest(tests, 2), 2);
    assert.throws(() => pickTest(tests, 3), /no test 3/);
    assert.throws(() => pickTest(tests, -1), /no test -1/);
  });

  it("takes a full name, or a part of one that is unique", () => {
    assert.equal(pickTest(tests, "Login > signs out"), 1);
    assert.equal(pickTest(tests, "adds"), 2);
    assert.throws(() => pickTest(tests, "Login"), /matches 2 tests/);
    assert.throws(() => pickTest(tests, "nope"), /No test matches "nope"/);
  });

  it("explains an empty file", () => {
    assert.throws(() => pickTest([], undefined), /--new/);
  });
});

describe("toolbarOptions", () => {
  const source = `import { test } from "@itmetsam/samurai-framework";
test("a", async ({ page }) => {
  await page.getByLabel("Pw").fill(secrets.PASSWORD);
  await page.screenshot({ name: "one" });
  await page.screenshot({ name: "two" });
});
`;
  const run = {
    settings: { environment: "staging", variables: { user: "sam" } },
    secrets: new Map([["TOKEN", "t"]]),
  } as never;

  it("lists the run's and the spec's secrets, with values only when set", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-toolbar-"));
    writeFileSync(path.join(dir, ".gitignore"), ".env.staging\n");
    const options = await toolbarOptions(
      run,
      source,
      dir,
      { environments: { staging: {} } } as never,
      0,
    );
    assert.deepEqual(options, {
      environment: "staging",
      canAddVariables: true,
      variables: { user: "sam" },
      secrets: { TOKEN: "t", PASSWORD: undefined },
      secretsIgnored: true,
      screenshots: 2,
    });
  });

  it("can't add variables without environments, and sees an unignored env file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-toolbar-"));
    const options = await toolbarOptions(run, source, dir, {} as never, 0);
    assert.equal(options.canAddVariables, false);
    assert.equal(options.secretsIgnored, false);
  });
});

describe("resultSecrets", () => {
  const fill = (name: string) =>
    ({ step: { kind: "fill", value: { kind: "secret", name } } }) as never;
  it("adds secrets saved from the panel, once, even when never typed", () => {
    assert.deepEqual(resultSecrets([fill("A"), fill("A")], ["B", "A"]), [
      "A",
      "B",
    ]);
    assert.deepEqual(resultSecrets([], ["ONLY_ADDED"]), ["ONLY_ADDED"]);
  });
});
