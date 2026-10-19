import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { parseSpec } from "../steps/parse.js";
import { addTest, prepareSpec, readSpec, SpecWriter } from "./spec-source.js";

const dir = mkdtempSync(path.join(tmpdir(), "samurai-spec-source-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const EXISTING = `import { test } from "@itmetsam/samurai-framework";\n\ntest("a", async ({ page }) => {\n  await page.goto("/");\n});\n`;

describe("readSpec", () => {
  it("returns the text of a file that exists", () => {
    const file = path.join(dir, "there.spec.ts");
    writeFileSync(file, EXISTING);
    assert.equal(readSpec(file, { file: "there.spec.ts" }), EXISTING);
  });

  it("returns undefined for a missing file when a test is to be created, and throws otherwise", () => {
    const file = path.join(dir, "missing.spec.ts");
    assert.equal(
      readSpec(file, { file: "missing.spec.ts", create: "new" }),
      undefined,
    );
    assert.throws(
      () => readSpec(file, { file: "missing.spec.ts" }),
      /missing\.spec\.ts does not exist; give a title with --new to create it/,
    );
  });
});

describe("prepareSpec", () => {
  it("creates the file and the test, and records from the end", () => {
    const file = path.join(dir, "sub", "created.spec.ts");
    const spec = prepareSpec(file, undefined, { create: "signs in" });
    assert.equal(spec.testName, "signs in");
    assert.equal(spec.at, 0);
    assert.equal(spec.testIndex, 0);
    assert.equal(readFileSync(file, "utf8"), addTest("", "signs in"));
  });

  it("picks the one test of an existing file and its step count", () => {
    const file = path.join(dir, "existing.spec.ts");
    const spec = prepareSpec(file, EXISTING, {});
    assert.equal(spec.testName, "a");
    assert.equal(spec.at, parseSpec(EXISTING)[0]!.steps.length);
  });

  it("refuses a step index outside the test, before writing", () => {
    const file = path.join(dir, "untouched.spec.ts");
    assert.throws(
      () => prepareSpec(file, EXISTING, { at: 5 }),
      /--at must be between 0 and 1 \(the test has 1 steps\)/,
    );
  });
});

describe("SpecWriter", () => {
  it("applies each event, writes the file and keeps the events", () => {
    const file = path.join(dir, "written.spec.ts");
    writeFileSync(file, EXISTING);
    const writer = new SpecWriter(EXISTING, file, 0);
    const event = {
      op: "insert" as const,
      index: 1,
      step: { kind: "waitForNetworkIdle" as const },
    };
    const text = writer.write(event);
    assert.equal(readFileSync(file, "utf8"), text);
    assert.match(text, /waitForNetworkIdle/);
    assert.deepEqual(writer.events, [event]);
  });
});
