import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const PRELOAD = path.resolve("scripts/test-tmp.mjs");
const root = mkdtempSync(path.join(tmpdir(), "samurai-tmptest-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** Runs a script with the preload and `TMPDIR` set to a folder of its own */
function run(script: string, name: string) {
  const parent = path.join(root, name);
  mkdirSync(parent, { recursive: true });
  const result = spawnSync(
    process.execPath,
    ["--import", PRELOAD, "-e", script],
    {
      env: { ...process.env, TMPDIR: parent },
      encoding: "utf8",
    },
  );
  return { parent, result };
}

describe("scripts/test-tmp.mjs", () => {
  it("gives the process a private temp folder, and removes it, with what the process left in it, when it ends", () => {
    const { parent, result } = run(
      `const os = require("node:os"), fs = require("node:fs"), path = require("node:path");
       const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-project-"));
       fs.writeFileSync(path.join(dir, "big-profile.bin"), "x");
       console.log(os.tmpdir());`,
      "private",
    );
    assert.equal(result.status, 0, result.stderr);
    const used = result.stdout.trim();
    assert.ok(used.startsWith(path.join(parent, "samurai-test-")), used);
    assert.ok(!existsSync(used), "the private folder is gone");
    assert.deepEqual(readdirSync(parent), [], "nothing is left in the parent");
  });

  it("removes the folder when the process fails", () => {
    const { parent, result } = run(
      `require("node:fs").mkdtempSync(require("node:os").tmpdir() + "/leak-"); throw new Error("boom");`,
      "failing",
    );
    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(parent), []);
  });

  it("removes the folder when the process is terminated", async () => {
    const parent = path.join(root, "terminated");
    mkdirSync(parent);
    const child = spawn(
      process.execPath,
      [
        "--import",
        PRELOAD,
        "-e",
        `require("node:fs").mkdtempSync(require("node:os").tmpdir() + "/leak-"); console.log("ready"); setInterval(() => {}, 1000);`,
      ],
      {
        env: { ...process.env, TMPDIR: parent },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    await new Promise<void>((resolve) =>
      child.stdout!.once("data", () => resolve()),
    );
    assert.equal(readdirSync(parent).length, 1, "the process has its folder");
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
    assert.deepEqual(readdirSync(parent), []);
  });

  it("sweeps the folders of processes that are gone, and keeps those of running ones", () => {
    const parent = path.join(root, "sweep");
    mkdirSync(parent);
    // A pid that cannot exist, and this test's own
    const dead = path.join(parent, "samurai-test-2147483646-abcdef");
    const live = path.join(parent, `samurai-test-${process.pid}-abcdef`);
    const other = path.join(parent, "samurai-something-else");
    for (const dir of [dead, live, other]) {
      mkdirSync(dir);
      writeFileSync(path.join(dir, "file"), "x");
    }
    const result = spawnSync(
      process.execPath,
      ["--import", PRELOAD, "-e", ""],
      {
        env: { ...process.env, TMPDIR: parent },
      },
    );
    assert.equal(result.status, 0, result.stderr?.toString());
    assert.ok(!existsSync(dead), "the dead process's folder is swept");
    assert.ok(existsSync(live), "a running process's folder stays");
    assert.ok(existsSync(other), "folders that are not ours stay");
  });
});
