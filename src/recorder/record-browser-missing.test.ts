import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { BrowserNotInstalledError } from "../browsers/store.js";
import { recordSpec } from "./session.js";

let dir: string;
const KEYS = ["SAMURAI_BROWSERS_PATH", "SAMURAI_FIREFOX_PATH"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "samurai-record-nobrowser-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  process.env.SAMURAI_BROWSERS_PATH = path.join(dir, "empty-cache");
  delete process.env.SAMURAI_FIREFOX_PATH;
});
after(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("recording without its browser", () => {
  it("fails and does not create the spec", async () => {
    await assert.rejects(
      recordSpec({
        projectDir: dir,
        config: {},
        file: "a.spec.ts",
        create: "signs in",
      }),
      BrowserNotInstalledError,
    );
    assert.equal(existsSync(path.join(dir, "a.spec.ts")), false);
  });
});
