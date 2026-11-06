import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("AGENT-GUIDE.md ships in the package and names real commands", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    files: string[];
  };
  assert.ok(manifest.files.includes("AGENT-GUIDE.md"));
  assert.ok(existsSync("AGENT-GUIDE.md"));
  const guide = readFileSync("AGENT-GUIDE.md", "utf8");
  for (const command of [
    "samurai list --json",
    "samurai run --json",
    "samurai record",
  ])
    assert.ok(guide.includes(command), command);
  assert.equal(/sk-[A-Za-z0-9]{10,}|api[_-]?key\s*[:=]/i.test(guide), false);
});
