import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { detectBrowserPlatform } from "@puppeteer/browsers";
import {
  puppeteerDownloader,
  type CachedBuild,
  type Downloader,
} from "./downloader.js";
import { PINNED } from "./pins.js";
import {
  BrowserNotInstalledError,
  COMPLETE_MARKER,
  installBrowser,
  listInstalled,
  managedExecutable,
  statusOf,
  uninstallBrowser,
} from "./store.js";

let cacheDir: string;
beforeEach(
  () => (cacheDir = mkdtempSync(path.join(tmpdir(), "samurai-store-"))),
);
afterEach(() => rmSync(cacheDir, { recursive: true, force: true }));

/** Unpacks into <cache>/<browser>/<buildId>/bin; `fail` names a browser part whose install throws after writing half a folder */
function fake(
  options: {
    fail?: string;
    platform?: string | undefined;
    /** ms each install takes */
    delay?: number;
    /** thrown by uninstall and clean, after nothing was removed (a locked file on Windows) */
    removeFails?: string;
  } = {},
) {
  const calls: string[] = [];
  const dirOf = (cache: string, b: string, id: string) =>
    path.join(cache, b, id);
  const downloader: Downloader = {
    platform: () => ("platform" in options ? options.platform : "mac_arm"),
    installDir: dirOf,
    executablePath: (cache, b, id) => path.join(dirOf(cache, b, id), "bin"),
    async install(cache, b, id, onProgress) {
      calls.push(`install ${b}@${id}`);
      const dir = dirOf(cache, b, id);
      // like puppeteer: refuses a build folder that is already there
      if (existsSync(dir)) throw new Error(`${dir} already exists`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "partial"), "");
      if (options.delay) await sleep(options.delay);
      if (options.fail === b) throw new Error("connection reset");
      onProgress?.(5, 10);
      onProgress?.(10, 10);
      writeFileSync(path.join(dir, "bin"), "binary");
    },
    clean(cache, b, id) {
      if (options.removeFails) throw new Error(options.removeFails);
      rmSync(dirOf(cache, b, id), { recursive: true, force: true });
      rmSync(path.join(cache, b, `${id}-archive.tar.xz`), { force: true });
    },
    uninstall(cache, b, id) {
      if (options.removeFails) throw new Error(options.removeFails);
      rmSync(dirOf(cache, b, id), { recursive: true, force: true });
    },
    list(cache) {
      const out: CachedBuild[] = [];
      for (const b of ["firefox", "chrome", "chromedriver"]) {
        const root = path.join(cache, b);
        if (!existsSync(root)) continue;
        for (const id of readdirSync(root))
          out.push({ browser: b, buildId: id, dir: path.join(root, id) });
      }
      return out;
    },
  };
  return { downloader, calls };
}

const ff = PINNED.firefox;

const stagingDirs = () =>
  readdirSync(cacheDir).filter((e) => e.startsWith(".staging-"));

describe("installBrowser", () => {
  it("installs, writes the marker last, and reports progress", async () => {
    const { downloader } = fake();
    const progress: number[] = [];
    const exe = await installBrowser("firefox", {
      cacheDir,
      downloader,
      onProgress: (done) => progress.push(done),
    });
    assert.equal(exe, path.join(cacheDir, "firefox", ff.buildId, "bin"));
    assert.ok(
      existsSync(path.join(cacheDir, "firefox", ff.buildId, COMPLETE_MARKER)),
    );
    assert.deepEqual(progress, [5, 10]);
  });

  it("does nothing when the build is complete", async () => {
    const { downloader, calls } = fake();
    await installBrowser("firefox", { cacheDir, downloader });
    await installBrowser("firefox", { cacheDir, downloader });
    assert.deepEqual(calls, [`install firefox@${ff.buildId}`]);
  });

  it("chrome brings chromedriver of the same build", async () => {
    const { downloader, calls } = fake();
    await installBrowser("chrome", { cacheDir, downloader });
    assert.deepEqual(calls, [
      `install chrome@${PINNED.chrome.buildId}`,
      `install chromedriver@${PINNED.chrome.buildId}`,
    ]);
  });

  it("a failed download leaves nothing and says what failed", async () => {
    const { downloader } = fake({ fail: "firefox" });
    await assert.rejects(
      installBrowser("firefox", { cacheDir, downloader }),
      new Error(`Could not download ${ff.label}: connection reset`),
    );
    assert.equal(existsSync(path.join(cacheDir, "firefox", ff.buildId)), false);
    assert.deepEqual(stagingDirs(), []);
  });

  it("chrome whose chromedriver fails removes both (Review Focus 3)", async () => {
    const { downloader } = fake({ fail: "chromedriver" });
    await assert.rejects(installBrowser("chrome", { cacheDir, downloader }));
    const id = PINNED.chrome.buildId;
    assert.equal(existsSync(path.join(cacheDir, "chrome", id)), false);
    assert.equal(existsSync(path.join(cacheDir, "chromedriver", id)), false);
    assert.equal(statusOf("chrome", { cacheDir, downloader }).state, "missing");
  });

  it("a folder without the marker counts as missing and is replaced (Review Focus 1)", async () => {
    const { downloader } = fake();
    const dir = path.join(cacheDir, "firefox", ff.buildId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "bin"), "half");
    assert.equal(
      statusOf("firefox", { cacheDir, downloader }).state,
      "missing",
    );
    await installBrowser("firefox", { cacheDir, downloader });
    assert.equal(
      statusOf("firefox", { cacheDir, downloader }).state,
      "installed",
    );
  });

  it("a leftover archive from a killed download is removed before installing", async () => {
    const { downloader } = fake();
    const archive = path.join(
      cacheDir,
      "firefox",
      `${ff.buildId}-archive.tar.xz`,
    );
    mkdirSync(path.dirname(archive), { recursive: true });
    writeFileSync(archive, "truncated");
    await installBrowser("firefox", { cacheDir, downloader });
    assert.equal(existsSync(archive), false);
  });

  it("two installs of one build at once both get it, complete, with no staging left (I2)", async () => {
    const { downloader } = fake({ delay: 30 });
    const [a, b] = await Promise.all([
      installBrowser("firefox", { cacheDir, downloader }),
      installBrowser("firefox", { cacheDir, downloader }),
    ]);
    const exe = path.join(cacheDir, "firefox", ff.buildId, "bin");
    assert.equal(a, exe);
    assert.equal(b, exe);
    assert.equal(
      statusOf("firefox", { cacheDir, downloader }).state,
      "installed",
    );
    assert.ok(existsSync(exe));
    assert.deepEqual(stagingDirs(), []);
  });

  it("downloads into a staging folder; the build folder appears only once complete", async () => {
    const { downloader } = fake({ delay: 30 });
    const dir = path.join(cacheDir, "firefox", ff.buildId);
    const pending = installBrowser("firefox", { cacheDir, downloader });
    await sleep(10);
    assert.equal(existsSync(dir), false);
    assert.equal(stagingDirs().length, 1);
    await pending;
    assert.ok(existsSync(path.join(dir, COMPLETE_MARKER)));
  });

  it("removes staging folders older than a day, keeps recent ones", async () => {
    const { downloader } = fake();
    const old = path.join(cacheDir, ".staging-old");
    const recent = path.join(cacheDir, ".staging-recent");
    mkdirSync(path.join(old, "firefox"), { recursive: true });
    mkdirSync(recent);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(old, twoDaysAgo, twoDaysAgo);
    await installBrowser("firefox", { cacheDir, downloader });
    assert.equal(existsSync(old), false);
    assert.ok(existsSync(recent));
  });

  it("a cleanup that fails reads as a failed download", async () => {
    const { downloader } = fake({ removeFails: "EBUSY: resource busy" });
    await assert.rejects(
      installBrowser("firefox", { cacheDir, downloader }),
      new Error(`Could not download ${ff.label}: EBUSY: resource busy`),
    );
    assert.deepEqual(stagingDirs(), []);
  });

  it("no download for this platform", async () => {
    const { downloader } = fake({ platform: undefined });
    await assert.rejects(
      installBrowser("firefox", { cacheDir, downloader }),
      new Error(
        `${ff.label} has no download for ${process.platform} ${process.arch}`,
      ),
    );
  });
});

describe("statusOf", () => {
  it("missing, installed with its path, unavailable", async () => {
    const { downloader } = fake();
    assert.deepEqual(statusOf("firefox", { cacheDir, downloader, env: {} }), {
      name: "firefox",
      label: ff.label,
      buildId: ff.buildId,
      state: "missing",
      launchable: true,
    });
    await installBrowser("firefox", { cacheDir, downloader });
    const s = statusOf("firefox", { cacheDir, downloader, env: {} });
    assert.equal(s.state, "installed");
    assert.equal(
      s.executablePath,
      path.join(cacheDir, "firefox", ff.buildId, "bin"),
    );
    assert.equal(
      statusOf("chrome", { cacheDir, downloader, env: {} }).launchable,
      false,
    );
    const none = fake({ platform: undefined }).downloader;
    assert.equal(
      statusOf("firefox", { cacheDir, downloader: none, env: {} }).state,
      "unavailable",
    );
  });

  it("shows an override from the env, then from the config", () => {
    const { downloader } = fake();
    assert.deepEqual(
      statusOf("firefox", {
        cacheDir,
        downloader,
        env: { SAMURAI_FIREFOX_PATH: "/opt/ff" },
      }).override,
      { path: path.resolve("/opt/ff"), from: "env" },
    );
    assert.deepEqual(
      statusOf("firefox", {
        cacheDir,
        downloader,
        env: {},
        browserPaths: { firefox: "bin/ff" },
        projectDir: "/p",
      }).override,
      { path: path.resolve("/p", "bin/ff"), from: "config" },
    );
  });
});

describe("managedExecutable", () => {
  it("throws BrowserNotInstalledError with the install command", () => {
    const { downloader } = fake();
    assert.throws(
      () => managedExecutable("firefox", { cacheDir, downloader }),
      (e: unknown) =>
        e instanceof BrowserNotInstalledError &&
        e.message ===
          `${ff.label} is not installed. Run: samurai browsers install firefox`,
    );
  });
});

describe("uninstallBrowser and listInstalled", () => {
  it("lists builds with sizes, flags foreign ones, removes chrome with its chromedriver", async () => {
    const { downloader } = fake();
    await installBrowser("firefox", { cacheDir, downloader });
    await installBrowser("chrome", { cacheDir, downloader });
    mkdirSync(path.join(cacheDir, "firefox", "stable_1.0"), {
      recursive: true,
    });
    const listed = listInstalled({ cacheDir, downloader });
    assert.deepEqual(
      listed.map((b) => [b.name, b.buildId, b.pinned]).sort(),
      [
        ["chrome", PINNED.chrome.buildId, true],
        ["firefox", "stable_1.0", false],
        ["firefox", ff.buildId, true],
      ].sort(),
    );
    assert.ok(listed.find((b) => b.buildId === ff.buildId)!.sizeBytes > 0);

    uninstallBrowser("chrome", undefined, { cacheDir, downloader });
    assert.equal(
      existsSync(path.join(cacheDir, "chromedriver", PINNED.chrome.buildId)),
      false,
    );
    uninstallBrowser("firefox", "stable_1.0", { cacheDir, downloader });
    assert.deepEqual(
      listInstalled({ cacheDir, downloader }).map((b) => b.buildId),
      [ff.buildId],
    );
  });
});

describe("uninstallBrowser", () => {
  it("removes the marker first, so a removal that fails halfway reads as missing (I3)", async () => {
    await installBrowser("firefox", {
      cacheDir,
      downloader: fake().downloader,
    });
    const { downloader } = fake({ removeFails: "EBUSY: resource busy" });
    assert.throws(
      () => uninstallBrowser("firefox", undefined, { cacheDir, downloader }),
      /EBUSY/,
    );
    assert.equal(
      statusOf("firefox", { cacheDir, downloader }).state,
      "missing",
    );
  });

  it("refuses a build id that leaves the cache", () => {
    const { downloader } = fake();
    for (const id of ["../x", "a/b", "a\\b", ".."])
      assert.throws(
        () => uninstallBrowser("firefox", id, { cacheDir, downloader }),
        new Error(`Invalid build id "${id}"`),
      );
  });
});

describe("puppeteerDownloader.clean", () => {
  it("removes the build folder and archives of that build, nothing else", () => {
    const platform = detectBrowserPlatform();
    if (!platform) return;
    const root = path.join(cacheDir, "firefox");
    const folder = path.join(root, `${platform}-${ff.buildId}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "x"), "");
    writeFileSync(path.join(root, `${ff.buildId}-archive.dmg`), "");
    writeFileSync(path.join(root, "other-archive.dmg"), "");
    puppeteerDownloader().clean(cacheDir, "firefox", ff.buildId);
    assert.equal(existsSync(folder), false);
    assert.equal(
      existsSync(path.join(root, `${ff.buildId}-archive.dmg`)),
      false,
    );
    assert.ok(existsSync(path.join(root, "other-archive.dmg")));
  });

  it("copes with a cache that has no such browser", () => {
    puppeteerDownloader().clean(cacheDir, "firefox", ff.buildId);
  });

  it("list ignores staging folders", () => {
    const platform = detectBrowserPlatform();
    if (!platform) return;
    mkdirSync(
      path.join(
        cacheDir,
        ".staging-abc",
        "firefox",
        `${platform}-${ff.buildId}`,
      ),
      { recursive: true },
    );
    assert.deepEqual(
      listInstalled({ cacheDir, downloader: puppeteerDownloader() }),
      [],
    );
  });
});
