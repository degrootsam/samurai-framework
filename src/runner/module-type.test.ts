import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { assertModuleProject } from "./module-type.js";

function project(manifest: string | undefined) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-module-"));
  mkdirSync(path.join(dir, "specs"));
  if (manifest !== undefined)
    writeFileSync(path.join(dir, "package.json"), manifest);
  return path.join(dir, "specs", "a.spec.ts");
}

describe("assertModuleProject", () => {
  it("accepts a project of ES modules, looking in parent folders", () => {
    assert.doesNotThrow(() =>
      assertModuleProject(project('{"type":"module"}')),
    );
  });

  it("rejects CommonJS and untyped projects", () => {
    assert.throws(
      () => assertModuleProject(project('{"type":"commonjs"}')),
      /must set "type": "module"/,
    );
    assert.throws(
      () => assertModuleProject(project("{}")),
      /must set "type": "module"/,
    );
  });

  it("rejects a manifest it cannot read", () => {
    assert.throws(() => assertModuleProject(project("{nope")), /Cannot read/);
  });

  it("does not check .mts files", () => {
    assert.doesNotThrow(() => assertModuleProject("/nowhere/a.spec.mts"));
  });
});
