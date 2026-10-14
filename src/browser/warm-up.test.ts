import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { LAUNCHED_STAMP, warmUp } from "./warm-up.js";

let buildDir: string;
beforeEach(
  () => (buildDir = mkdtempSync(path.join(tmpdir(), "samurai-warm-"))),
);
afterEach(() => rmSync(buildDir, { recursive: true, force: true }));

const managed = () => ({
  executablePath: path.join(buildDir, "firefox"),
  label: "Firefox 158.0",
  buildDir,
});

/** Counts launches and closes; `fail` rejects the launch */
function launcher(fail?: Error) {
  const calls: string[] = [];
  const launch = async () => {
    calls.push("launch");
    if (fail) throw fail;
    return { close: async () => void calls.push("close") };
  };
  return { calls, launch };
}

describe("warmUp", () => {
  it("starts a managed build once, closes it, then stamps its folder", async () => {
    const { calls, launch } = launcher();
    await warmUp(managed(), launch);
    assert.deepEqual(calls, ["launch", "close"]);
    assert.ok(existsSync(path.join(buildDir, LAUNCHED_STAMP)));
    await warmUp(managed(), launch);
    assert.deepEqual(calls, ["launch", "close"]);
  });

  it("does not start a build whose folder is stamped", async () => {
    writeFileSync(path.join(buildDir, LAUNCHED_STAMP), "");
    const { calls, launch } = launcher();
    await warmUp(managed(), launch);
    assert.deepEqual(calls, []);
  });

  it("skips a browser set by env or config", async () => {
    const { calls, launch } = launcher();
    await warmUp({ executablePath: "/opt/ff", label: "Firefox" }, launch);
    assert.deepEqual(calls, []);
  });

  it("a failed start is an error and leaves no stamp", async () => {
    const { launch } = launcher(
      new Error("Browser process exited unexpectedly with code 1"),
    );
    await assert.rejects(
      warmUp(managed(), launch),
      new Error(
        "Could not start Firefox 158.0 for the first time: Browser process exited unexpectedly with code 1",
      ),
    );
    assert.equal(existsSync(path.join(buildDir, LAUNCHED_STAMP)), false);
  });

  it("an aborted run skips it, and a start the abort ended is no error", async () => {
    const { calls, launch } = launcher();
    const aborted = AbortSignal.abort();
    await warmUp(managed(), launch, aborted);
    assert.deepEqual(calls, []);
    const controller = new AbortController();
    await warmUp(
      managed(),
      async () => {
        controller.abort(new Error("Run aborted"));
        throw new Error("Run aborted");
      },
      controller.signal,
    );
    assert.equal(existsSync(path.join(buildDir, LAUNCHED_STAMP)), false);
  });
});
