import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  browsersDir,
  loadRawConfig,
  projectConfig,
  projectDir,
  setActiveProject,
} from "./config.js";
import { loadSecrets } from "./secrets.js";

afterEach(() => {
  setActiveProject(undefined);
  delete process.env.SAMURAI_DATA_DIR;
});

describe("active project", () => {
  it("is the working directory until a project is set", () => {
    assert.equal(projectDir(), process.cwd());
    setActiveProject({ dir: "/work/shop" });
    assert.equal(projectDir(), path.resolve("/work/shop"));
    setActiveProject(undefined);
    assert.equal(projectDir(), process.cwd());
  });

  it("projectConfig leaves a project that was already active active", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "samurai-other-"));
    await writeFile(
      path.join(other, "samurai.config.ts"),
      "export default { timeout: 77 };\n",
    );
    setActiveProject({ dir: "/work/shop", config: { timeout: 1 } });
    assert.deepEqual(await projectConfig({ projectDir: other }), {
      timeout: 77,
    });
    assert.equal(projectDir(), path.resolve("/work/shop"));
    assert.deepEqual(await loadRawConfig(), { timeout: 1 });
  });

  it("serves its own config instead of reading a file", async () => {
    setActiveProject({ dir: "/nowhere", config: { timeout: 1234 } });
    assert.deepEqual(await loadRawConfig(), { timeout: 1234 });
  });

  it("keeps browser profiles in the project, in dataDir, or in SAMURAI_DATA_DIR", () => {
    setActiveProject({ dir: "/work/shop" });
    assert.equal(browsersDir(), path.resolve("/work/shop/browsers"));
    setActiveProject({ dir: "/work/shop", dataDir: "/data/samurai" });
    assert.equal(browsersDir(), path.resolve("/data/samurai"));
    process.env.SAMURAI_DATA_DIR = "/env/samurai";
    assert.equal(browsersDir(), path.resolve("/env/samurai"));
  });

  it("reads secrets from the project folder", () => {
    setActiveProject({ dir: "/definitely/not/a/folder" });
    assert.equal(
      loadSecrets("dev", {
        env: { SAMURAI_SECRET_A: "x" } as unknown as NodeJS.ProcessEnv,
      }).get("A"),
      "x",
    );
  });
});
