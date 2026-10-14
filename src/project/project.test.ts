import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { hasConfigPath } from "./config-edit.js";
import { isGitIgnored, setSecret } from "./secrets-file.js";
import { addVariable } from "./variables.js";

const CONFIG = `import { defineConfig } from "@itmetsam/samurai-framework";

export default defineConfig({
  // keep me
  environments: {
    dev: { baseURL: "http://localhost:3000" },
  },
});
`;

describe("project writers", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "samurai-project-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("addVariable writes environments.<env>.variables", async () => {
    writeFileSync(join(dir, "samurai.config.ts"), CONFIG);
    await addVariable(dir, "dev", "adminUser", "admin@example.com");
    const out = readFileSync(join(dir, "samurai.config.ts"), "utf8");
    assert.equal(
      hasConfigPath(out, ["environments", "dev", "variables", "adminUser"]),
      true,
    );
    assert.match(out, /admin@example\.com/);
  });

  it("addVariable refuses an existing name and a bad name", async () => {
    writeFileSync(join(dir, "samurai.config.ts"), CONFIG);
    await addVariable(dir, "dev", "a", "1");
    await assert.rejects(
      addVariable(dir, "dev", "a", "2"),
      /"a" already exists/,
    );
    await assert.rejects(
      addVariable(dir, "dev", "1x", "2"),
      /Use letters, digits and _/,
    );
  });

  it("setSecret adds and replaces SAMURAI_SECRET_ lines", async () => {
    writeFileSync(join(dir, ".env.dev"), "OTHER=1\nSAMURAI_SECRET_A=old\n");
    await setSecret(dir, "dev", "A", "new value");
    await setSecret(dir, "dev", "B", "x");
    assert.equal(
      readFileSync(join(dir, ".env.dev"), "utf8"),
      "OTHER=1\nSAMURAI_SECRET_A='new value'\nSAMURAI_SECRET_B=x\n",
    );
    await assert.rejects(
      setSecret(dir, "dev", "lower", "x"),
      /UPPER_SNAKE_CASE/,
    );
  });

  it("isGitIgnored reads .gitignore", async () => {
    assert.equal(await isGitIgnored(dir, ".env.dev"), false);
    writeFileSync(join(dir, ".gitignore"), "node_modules\n.env*\n");
    assert.equal(await isGitIgnored(dir, ".env.dev"), true);
  });
});
