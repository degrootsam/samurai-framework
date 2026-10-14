import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { BrowserNotInstalledError } from "../browsers/store.js";
import type { RunEvent } from "./reporter.js";
import { runTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
let dir: string;
const KEYS = ["SAMURAI_BROWSERS_PATH", "SAMURAI_FIREFOX_PATH"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "samurai-nobrowser-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(dir, "src"));
  writeFileSync(
    path.join(dir, "src/a.spec.ts"),
    `import { test } from ${API};\ntest("a", async () => {});`,
  );
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

describe("a run without its browser", () => {
  it("fails once, before any test starts", async () => {
    const events: RunEvent[] = [];
    await assert.rejects(
      runTests({ projectDir: dir, config: {}, onEvent: (e) => events.push(e) }),
      BrowserNotInstalledError,
    );
    assert.deepEqual(events, []);
  });

  it("selecting no tests needs no browser (Review Focus 5)", async () => {
    const summary = await runTests({
      projectDir: dir,
      config: {},
      grep: "nothing matches",
    });
    assert.equal(summary.status, "success");
  });
});
