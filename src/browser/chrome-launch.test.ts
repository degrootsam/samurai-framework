import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "node:test";
import {
  chromeCapabilities,
  chromeFlags,
  chromeUsingProfile,
  ChromeProfileInUseError,
  launchChrome,
} from "./chrome-launch.js";

const launch = {
  executablePath: "/opt/chrome",
  driverPath: "/opt/chromedriver",
  profileDir: "/tmp/profile",
  headless: true,
  commandTimeout: undefined,
};

describe("chromeFlags", () => {
  it("uses the project profile and runs headless when asked", () => {
    const flags = chromeFlags(launch);
    assert.ok(flags.includes("--user-data-dir=/tmp/profile"));
    assert.ok(flags.includes("--headless=new"));
    assert.ok(
      !chromeFlags({ ...launch, headless: false }).includes("--headless=new"),
    );
  });

  it("hides scrollbars when headless, so the viewport is the size asked for, and keeps them when headed", () => {
    assert.ok(chromeFlags(launch).includes("--hide-scrollbars"));
    assert.ok(
      !chromeFlags({ ...launch, headless: false }).includes(
        "--hide-scrollbars",
      ),
    );
  });
});

describe("chromeCapabilities", () => {
  it("asks chromedriver for a BiDi socket and leaves dialogs to the framework", () => {
    const { alwaysMatch } = chromeCapabilities(launch).capabilities;
    assert.equal(alwaysMatch.webSocketUrl, true);
    assert.deepEqual(alwaysMatch.unhandledPromptBehavior, {
      default: "ignore",
    });
    assert.equal(alwaysMatch["goog:chromeOptions"].binary, "/opt/chrome");
  });
});

describe("chromeUsingProfile", () => {
  let dir: string;
  beforeEach(
    () => (dir = mkdtempSync(path.join(tmpdir(), "samurai-chrome-profile-"))),
  );
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const lock = (target: string) =>
    symlinkSync(target, path.join(dir, "SingletonLock"));

  it("finds the Chrome that holds the profile", () => {
    lock("myhost-4242");
    assert.equal(
      chromeUsingProfile(dir, "myhost", () => true),
      4242,
    );
  });

  it("ignores a profile without a lock, a lock of a process that is gone, another computer's lock and a lock it cannot read", () => {
    assert.equal(
      chromeUsingProfile(dir, "myhost", () => true),
      undefined,
      "no lock",
    );
    lock("myhost-4242");
    assert.equal(
      chromeUsingProfile(dir, "myhost", () => false),
      undefined,
      "process gone",
    );
    assert.equal(
      chromeUsingProfile(dir, "otherhost", () => true),
      undefined,
      "another computer",
    );
    rmSync(path.join(dir, "SingletonLock"));
    lock("garbage");
    assert.equal(
      chromeUsingProfile(dir, "myhost", () => true),
      undefined,
      "unreadable",
    );
  });

  it("launchChrome refuses a profile in use at once, naming the process", async () => {
    lock(`${(await import("node:os")).hostname()}-${process.pid}`);
    await assert.rejects(
      launchChrome({
        executablePath: "/nope",
        driverPath: "/nope",
        profileDir: dir,
        headless: true,
        commandTimeout: undefined,
      }),
      (err: unknown) => {
        assert.ok(err instanceof ChromeProfileInUseError);
        assert.equal(err.pid, process.pid);
        assert.match(
          err.message,
          /already running on the profile .* \(process \d+\)/,
        );
        return true;
      },
    );
  });
});
