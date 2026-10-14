import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const bin = path.resolve(import.meta.dirname, "../../bin/samurai.mjs");

/** A project folder, with its own copy of the framework when `local` is given (its CLI prints `local`) */
function project(local?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-bin-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  if (local !== undefined) {
    const copy = path.join(dir, "node_modules/@itmetsam/samurai-framework");
    mkdirSync(path.join(copy, "bin"), { recursive: true });
    writeFileSync(
      path.join(copy, "package.json"),
      '{"name":"@itmetsam/samurai-framework","version":"9.9.9","type":"module","exports":{"./package.json":"./package.json"}}',
    );
    writeFileSync(
      path.join(copy, "bin/samurai.mjs"),
      `process.stdout.write(${JSON.stringify(local)} + " " + process.argv.slice(2).join(" "));\nprocess.exit(0);\n`,
    );
  }
  return dir;
}

const run = (cwd: string, ...args: string[]) =>
  execFileSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" });

describe("the samurai binary", () => {
  it("hands over to the project's own framework, so specs and the runner share one copy", () => {
    assert.equal(
      run(project("local"), "list", "--grep", "x"),
      "local list --grep x",
    );
  });

  it("runs itself in a folder without a framework of its own", () => {
    assert.match(run(project(), "--version"), /^\d+\.\d+\.\d+/);
  });
});
