import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { SamuraiTestConfig } from "../types/config.js";
import { listGroups, listTests, runTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
const COUNTER = "__samuraiSpecImports";
let dir: string;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "samurai-imports-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(dir, "src"));
  // Top-level code of a spec: it runs every time the file is imported
  writeFileSync(
    path.join(dir, "src/a.spec.ts"),
    `import { test } from ${API};
(globalThis as any).${COUNTER} = ((globalThis as any).${COUNTER} ?? 0) + 1;
test("a", async () => {});`,
  );
});

after(() => rmSync(dir, { recursive: true, force: true }));

const config: SamuraiTestConfig = {
  groups: [{ name: "all", browsers: ["firefox"] }],
};
const imports = () =>
  (globalThis as unknown as Record<string, number>)[COUNTER] ?? 0;
const reset = () =>
  delete (globalThis as unknown as Record<string, unknown>)[COUNTER];

describe("a run imports the specs once", () => {
  it("also when a group is selected", async () => {
    reset();
    await listTests({ projectDir: dir, config, group: "all" });
    assert.equal(imports(), 1);
  });

  it("when groups are listed", async () => {
    reset();
    await listGroups({ projectDir: dir, config });
    assert.equal(imports(), 1);
  });

  it("when a run with a group starts (no test selected, so no browser opens)", async () => {
    reset();
    await runTests({
      projectDir: dir,
      config,
      group: "all",
      grep: "nothing matches this",
      reportPath: false,
    });
    assert.equal(imports(), 1);
  });
});
