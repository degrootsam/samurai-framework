import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadInstructions, MAX_INSTRUCTIONS_BYTES } from "./instructions.js";

const project = () => mkdtempSync(path.join(os.tmpdir(), "agent-instr-"));

test("a project without instruction files has none", () => {
  assert.deepEqual(loadInstructions(project()), { files: [], text: "" });
});

test("AGENTS.md is read, and .samurai/agent.md comes last so it wins", () => {
  const dir = project();
  writeFileSync(path.join(dir, "AGENTS.md"), "Use Dutch labels.\n");
  mkdirSync(path.join(dir, ".samurai"));
  writeFileSync(
    path.join(dir, ".samurai", "agent.md"),
    "Use English labels.\n",
  );
  const { files, text } = loadInstructions(dir);
  assert.deepEqual(files, ["AGENTS.md", path.join(".samurai", "agent.md")]);
  assert.ok(
    text.indexOf("Use Dutch labels.") < text.indexOf("Use English labels."),
  );
  assert.match(text, /### From \.samurai\/agent\.md/);
});

test("either file alone is enough", () => {
  const dir = project();
  mkdirSync(path.join(dir, ".samurai"));
  writeFileSync(path.join(dir, ".samurai", "agent.md"), "Only mine.");
  assert.deepEqual(loadInstructions(dir).files, [
    path.join(".samurai", "agent.md"),
  ]);
});

test("files larger than the limit together are an error that names the sizes", () => {
  const dir = project();
  writeFileSync(
    path.join(dir, "AGENTS.md"),
    "a".repeat(MAX_INSTRUCTIONS_BYTES / 2 + 1),
  );
  mkdirSync(path.join(dir, ".samurai"));
  writeFileSync(
    path.join(dir, ".samurai", "agent.md"),
    "b".repeat(MAX_INSTRUCTIONS_BYTES / 2 + 1),
  );
  assert.throws(
    () => loadInstructions(dir),
    /agent\(\): the instruction files hold 33 KB, over the 32 KB limit \(AGENTS\.md 17 KB, \.samurai\/agent\.md 17 KB\); shorten them/,
  );
});

test("exactly the limit is accepted", () => {
  const dir = project();
  writeFileSync(
    path.join(dir, "AGENTS.md"),
    "a".repeat(MAX_INSTRUCTIONS_BYTES),
  );
  assert.equal(loadInstructions(dir).files.length, 1);
});

test("a link to a file outside the project is refused, never read", () => {
  const outside = project();
  writeFileSync(path.join(outside, "secret.md"), "TOP-SECRET-TEXT");
  const dir = project();
  symlinkSync(path.join(outside, "secret.md"), path.join(dir, "AGENTS.md"));
  assert.throws(
    () => loadInstructions(dir),
    (error: Error) =>
      /AGENTS\.md points outside the project folder/.test(error.message) &&
      !error.message.includes("TOP-SECRET-TEXT"),
  );
});

test("a link inside the project is followed", () => {
  const dir = project();
  writeFileSync(path.join(dir, "rules.md"), "From a link.");
  symlinkSync(path.join(dir, "rules.md"), path.join(dir, "AGENTS.md"));
  assert.match(loadInstructions(dir).text, /From a link\./);
});
