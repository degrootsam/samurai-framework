import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdit } from "./edit.js";
import { stepToSource } from "./emit.js";
import type { Step } from "./model.js";
import { stepsOf, wrap } from "../testing/spec-source.js";

describe("file steps", () => {
  const input = {
    chain: [{ method: "getByLabel" as const, text: "Avatar" }],
    fallbacks: [],
  };
  const generated = (name: string, size: number, extra: object = {}) => ({
    generate: { name, size, ...extra },
  });

  it("round-trips one file, several, none and generated ones", () => {
    const steps: Step[] = [
      {
        kind: "setInputFiles",
        locator: input,
        files: [{ path: "files/avatar.png" }],
      },
      {
        kind: "dropFiles",
        locator: input,
        files: [{ path: "files/a.png" }, { path: "files/b.png" }],
      },
      { kind: "setInputFiles", locator: input, files: [] },
      {
        kind: "setInputFiles",
        locator: input,
        files: [
          generated("huge.pdf", 60 * 1024 ** 2, {
            type: "application/pdf",
            sizeSource: `"60 MB"`,
          }),
        ],
      },
      {
        kind: "dropFiles",
        locator: input,
        files: [generated("raw.bin", 2048, { sizeSource: "2048" })],
      },
    ];
    const source = wrap(...steps.map(stepToSource));
    assert.deepEqual(stepsOf(source), steps);
  });

  it("writes the source forms", () => {
    assert.equal(
      stepToSource({
        kind: "setInputFiles",
        locator: input,
        files: [{ path: "files/a.png" }],
      }),
      `await page.getByLabel("Avatar").setInputFiles("files/a.png");`,
    );
    assert.equal(
      stepToSource({ kind: "setInputFiles", locator: input, files: [] }),
      `await page.getByLabel("Avatar").setInputFiles([]);`,
    );
    assert.equal(
      stepToSource({
        kind: "dropFiles",
        locator: input,
        files: [generated("x.bin", 1536 * 1024)],
      }),
      `await page.getByLabel("Avatar").dropFiles(generatedFile({ name: "x.bin", size: "1536 KB" }));`,
    );
  });

  it("keeps the size as written while it still means the same size", () => {
    const [step] = stepsOf(
      wrap(
        `await page.getByLabel("Avatar").setInputFiles(generatedFile({ name: "a", size: "1024 KB" }));`,
      ),
    ) as [Extract<Step, { kind: "setInputFiles" }>];
    assert.match(stepToSource(step), /size: "1024 KB"/);
    const bigger = {
      ...step,
      files: [generated("a", 2 * 1024 ** 2, { sizeSource: `"1024 KB"` })],
    };
    assert.match(stepToSource(bigger), /size: "2 MB"/);
  });

  it("keeps other arguments as custom code", () => {
    for (const code of [
      `await page.getByLabel("Avatar").setInputFiles(file);`,
      `await page.getByLabel("Avatar").setInputFiles("a.png", { timeout: 1 });`,
      `await page.getByLabel("Avatar").dropFiles(generatedFile({ name: "a", size: "lots" }));`,
      `await page.getByLabel("Avatar").dropFiles(generatedFile({ name: "a", size: 1, extra: 1 }));`,
      `await page.getByLabel("Avatar").setInputFiles(["a.png", other]);`,
    ])
      assert.equal(stepsOf(wrap(code))[0]!.kind, "custom", code);
  });

  it("adds generatedFile to the import test comes from, once", () => {
    const source = `import { expect, test } from "@itmetsam/samurai-framework";\n\ntest("t", async ({ page }) => {\n});\n`;
    const step: Step = {
      kind: "dropFiles",
      locator: input,
      files: [generated("a.bin", 1)],
    };
    let next = applyEdit(source, { op: "insert", test: 0, index: 0, step });
    next = applyEdit(next, { op: "insert", test: 0, index: 1, step });
    assert.match(
      next,
      /^import \{ expect, test, generatedFile \} from "@itmetsam\/samurai-framework";/,
    );
    assert.equal(next.match(/generatedFile \}/g)?.length, 1);
  });

  it("leaves an existing generatedFile import alone, and adds an import when test isn't imported", () => {
    const own = `import { test } from "@itmetsam/samurai-framework";\nimport { generatedFile } from "@itmetsam/samurai-framework";\n\ntest("t", async ({ page }) => {\n});\n`;
    const step: Step = {
      kind: "dropFiles",
      locator: input,
      files: [generated("a.bin", 1)],
    };
    assert.equal(
      applyEdit(own, { op: "insert", test: 0, index: 0, step }).match(
        /generatedFile/g,
      )?.length,
      2, // the import and the step
    );
    const bare = `test("t", async ({ page }) => {\n});\n`;
    assert.match(
      applyEdit(bare, { op: "insert", test: 0, index: 0, step }),
      /^import \{ generatedFile \} from "@itmetsam\/samurai-framework";\n/,
    );
  });

  it("adds a framework import when test comes from elsewhere, and when generatedFile is only aliased", () => {
    const step: Step = {
      kind: "dropFiles",
      locator: input,
      files: [generated("a.bin", 1)],
    };
    const other = `import { test } from "./fixtures";\n\ntest("t", async ({ page }) => {\n});\n`;
    const next = applyEdit(other, { op: "insert", test: 0, index: 0, step });
    assert.match(
      next,
      /^import \{ generatedFile \} from "@itmetsam\/samurai-framework";\nimport \{ test \} from "\.\/fixtures";/,
    );
    const aliased = `import { test, generatedFile as gf } from "@itmetsam/samurai-framework";\n\ntest("t", async ({ page }) => {\n});\n`;
    assert.match(
      applyEdit(aliased, { op: "insert", test: 0, index: 0, step }),
      /^import \{ test, generatedFile as gf, generatedFile \} from "@itmetsam\/samurai-framework";/,
    );
  });

  it("a path-only step adds no import", () => {
    const source = `import { test } from "x";\n\ntest("t", async ({ page }) => {\n});\n`;
    const next = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 0,
      step: {
        kind: "setInputFiles",
        locator: input,
        files: [{ path: "files/a.png" }],
      },
    });
    assert.ok(next.startsWith(`import { test } from "x";`));
  });
});
