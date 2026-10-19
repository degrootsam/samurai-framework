import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Downloader } from "./downloader.js";
import { PINNED } from "./pins.js";
import { browserStatus, resolveBrowser, resolveExecutable } from "./resolve.js";
import { BrowserNotInstalledError, COMPLETE_MARKER } from "./store.js";

let dir: string;
beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "samurai-resolve-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const downloader: Downloader = {
  platform: () => "linux",
  installDir: (c, b, id) => path.join(c, b, id),
  executablePath: (c, b, id) => path.join(c, b, id, "bin"),
  install: async () => {},
  uninstall: () => {},
  clean: () => {},
  list: () => [],
};
const installFirefox = () => {
  const build = path.join(dir, "cache", "firefox", PINNED.firefox.buildId);
  mkdirSync(build, { recursive: true });
  writeFileSync(path.join(build, COMPLETE_MARKER), "");
  return path.join(build, "bin");
};
const file = (name: string) => {
  const p = path.join(dir, name);
  writeFileSync(p, "");
  return p;
};
const store = () => ({ cacheDir: path.join(dir, "cache"), downloader });

describe("resolveExecutable", () => {
  it("env before config before the managed build", () => {
    const managed = installFirefox();
    const fromEnv = file("env-ff");
    file("config-ff");
    assert.equal(
      resolveExecutable("firefox", {
        ...store(),
        env: { SAMURAI_FIREFOX_PATH: fromEnv },
        browserPaths: { firefox: "config-ff" },
        projectDir: dir,
      }),
      fromEnv,
    );
    assert.equal(
      resolveExecutable("firefox", {
        ...store(),
        env: {},
        browserPaths: { firefox: "config-ff" },
        projectDir: dir,
      }),
      path.join(dir, "config-ff"),
    );
    assert.equal(
      resolveExecutable("firefox", { ...store(), env: {} }),
      managed,
    );
  });

  it("a missing env path is an error, never the managed build", () => {
    installFirefox();
    const missing = path.join(dir, "nope");
    assert.throws(
      () =>
        resolveExecutable("firefox", {
          ...store(),
          env: { SAMURAI_FIREFOX_PATH: missing },
        }),
      new Error(`SAMURAI_FIREFOX_PATH points to a missing file: ${missing}`),
    );
  });

  it("a missing config path is an error", () => {
    assert.throws(
      () =>
        resolveExecutable("firefox", {
          ...store(),
          env: {},
          browserPaths: { firefox: "nope" },
          projectDir: dir,
        }),
      new Error(
        `browserPaths.firefox in samurai.config.ts points to a missing file: ${path.join(dir, "nope")}`,
      ),
    );
  });

  it("nothing found: BrowserNotInstalledError", () => {
    assert.throws(
      () => resolveExecutable("firefox", { ...store(), env: {} }),
      BrowserNotInstalledError,
    );
  });
});

describe("resolveBrowser", () => {
  it("the managed build carries its pinned label and folder; an override neither", () => {
    const managed = installFirefox();
    assert.deepEqual(resolveBrowser("firefox", { ...store(), env: {} }), {
      executablePath: managed,
      label: PINNED.firefox.label,
      buildDir: path.dirname(managed),
    });
    const fromEnv = file("env-ff");
    assert.deepEqual(
      resolveBrowser("firefox", {
        ...store(),
        env: { SAMURAI_FIREFOX_PATH: fromEnv },
      }),
      { executablePath: fromEnv, label: "Firefox" },
    );
  });
});

describe("browserStatus", () => {
  it("both pinned browsers, with the config's override", async () => {
    const statuses = await browserStatus({
      ...store(),
      env: {},
      projectDir: dir,
      config: { browserPaths: { firefox: "ff" } },
    });
    assert.deepEqual(
      statuses.map((s) => s.name),
      ["firefox", "chrome"],
    );
    assert.deepEqual(statuses[0]!.override, {
      path: path.join(dir, "ff"),
      from: "config",
    });
  });

  it("answers when the config doesn't import (Review Focus 2)", async () => {
    writeFileSync(path.join(dir, "samurai.config.ts"), "export default {;");
    const statuses = await browserStatus({
      ...store(),
      env: {},
      projectDir: dir,
    });
    assert.equal(statuses[0]!.state, "missing");
    assert.equal(statuses[0]!.override, undefined);
  });
});

describe("resolveBrowser for Chrome", () => {
  const installChrome = () => {
    const build = path.join(dir, "cache", "chrome", PINNED.chrome.buildId);
    mkdirSync(build, { recursive: true });
    writeFileSync(path.join(build, COMPLETE_MARKER), "");
    return path.join(build, "bin");
  };

  it("brings the chromedriver installed with it", () => {
    const chrome = installChrome();
    const resolved = resolveBrowser("chrome", { ...store(), env: {} });
    assert.equal(resolved.executablePath, chrome);
    assert.equal(
      resolved.driverPath,
      path.join(dir, "cache", "chromedriver", PINNED.chrome.buildId, "bin"),
    );
  });

  it("SAMURAI_CHROMEDRIVER_PATH replaces the managed chromedriver and must exist", () => {
    installChrome();
    const driver = file("my-chromedriver");
    assert.equal(
      resolveBrowser("chrome", {
        ...store(),
        env: { SAMURAI_CHROMEDRIVER_PATH: driver },
      }).driverPath,
      driver,
    );
    assert.throws(
      () =>
        resolveBrowser("chrome", {
          ...store(),
          env: { SAMURAI_CHROMEDRIVER_PATH: path.join(dir, "nope") },
        }),
      /SAMURAI_CHROMEDRIVER_PATH points to a missing file/,
    );
  });

  it("a Chrome set by path still gets the managed chromedriver", () => {
    installChrome();
    const mine = file("my-chrome");
    const resolved = resolveBrowser("chrome", {
      ...store(),
      env: { SAMURAI_CHROME_PATH: mine },
    });
    assert.equal(resolved.executablePath, mine);
    assert.ok(resolved.driverPath?.includes("chromedriver"));
  });

  it("is not installed without the managed chromedriver or a path to one", () => {
    assert.throws(
      () => resolveBrowser("chrome", { ...store(), env: {} }),
      BrowserNotInstalledError,
    );
  });
});
