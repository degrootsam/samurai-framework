// src/browser/generated-files.test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setActiveProject } from "../config/config.js";
import {
  generatedFile,
  isGeneratedFile,
  removeGeneratedFiles,
  resolveFileInputs,
} from "./generated-files.js";

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

describe("generated files", () => {
  afterEach(async () => {
    await removeGeneratedFiles();
    setActiveProject(undefined);
  });

  it("checks name and size", () => {
    assert.equal(generatedFile({ name: "a.pdf", size: "2 KB" }).size, 2048);
    assert.ok(isGeneratedFile(generatedFile({ name: "a", size: 1 })));
    assert.ok(!isGeneratedFile({ name: "a", size: 1 }));
    assert.throws(
      () => generatedFile({ name: "a", size: "lots" }),
      /size must be/,
    );
    assert.throws(
      () => generatedFile({ name: "", size: 1 }),
      /name must be a file name/,
    );
    assert.equal(generatedFile({ name: "dir/a.bin", size: 1 }).name, "a.bin");
  });

  it("writes the exact size under result/files, the same bytes every run, and removes them", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-gen-"));
    setActiveProject({ dir });
    const entry = generatedFile({ name: "big.bin", size: 3 * 1024 * 1024 + 5 });
    const [file] = await resolveFileInputs(entry, "setInputFiles");
    assert.equal(path.dirname(file!), path.join(dir, "result", "files"));
    assert.equal(statSync(file!).size, 3 * 1024 * 1024 + 5);
    const first = sha(file!);
    assert.deepEqual(
      await resolveFileInputs([entry, entry], "x"),
      [file, file],
      "written once per run",
    );
    await removeGeneratedFiles();
    assert.ok(!existsSync(file!));
    const [again] = await resolveFileInputs(entry, "setInputFiles");
    assert.equal(sha(again!), first);
  });

  it("resolves project paths against the project folder and names missing ones", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-gen-"));
    mkdirSync(path.join(dir, "files"));
    writeFileSync(path.join(dir, "files", "a.txt"), "a");
    setActiveProject({ dir });
    assert.deepEqual(await resolveFileInputs("files/a.txt", "setInputFiles"), [
      path.join(dir, "files", "a.txt"),
    ]);
    await assert.rejects(
      resolveFileInputs("files/b.txt", "dropFiles"),
      new Error("dropFiles(): files/b.txt doesn't exist in the project"),
    );
    const absolute = path.join(dir, "nope.txt");
    await assert.rejects(
      resolveFileInputs(absolute, "setInputFiles"),
      new Error(`setInputFiles(): file not found: ${absolute}`),
    );
  });
});
