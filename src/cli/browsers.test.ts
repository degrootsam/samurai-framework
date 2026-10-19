import assert from "node:assert/strict";
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
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Downloader } from "../browsers/downloader.js";
import { PINNED } from "../browsers/pins.js";
import { browsersCommand, formatBytes } from "./browsers.js";
import type { Io } from "./io.js";

let cacheDir: string;
beforeEach(
  () => (cacheDir = mkdtempSync(path.join(tmpdir(), "samurai-cli-browsers-"))),
);
afterEach(() => rmSync(cacheDir, { recursive: true, force: true }));

const downloader: Downloader = {
  platform: () => "linux",
  installDir: (c, b, id) => path.join(c, b, id),
  executablePath: (c, b, id) => path.join(c, b, id, "bin"),
  async install(c, b, id, onProgress) {
    mkdirSync(path.join(c, b, id), { recursive: true });
    writeFileSync(path.join(c, b, id, "bin"), "x".repeat(2048));
    onProgress?.(1, 2);
    onProgress?.(2, 2);
  },
  clean: (c, b, id) =>
    rmSync(path.join(c, b, id), { recursive: true, force: true }),
  uninstall: (c, b, id) =>
    rmSync(path.join(c, b, id), { recursive: true, force: true }),
  list: (c) =>
    ["firefox", "chrome", "chromedriver"].flatMap((b) =>
      existsSync(path.join(c, b))
        ? readdirSync(path.join(c, b)).map((id) => ({
            browser: b,
            buildId: id,
            dir: path.join(c, b, id),
          }))
        : [],
    ),
};

function io(env: Partial<NodeJS.ProcessEnv> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const target: Io = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    color: false,
    env,
  };
  return { target, out: () => out.join(""), err: () => err.join("") };
}
const run = (argv: string[], t = io()) =>
  browsersCommand(argv, t.target, { cacheDir, downloader }).then((code) => ({
    code,
    ...t,
  }));

describe("samurai browsers", () => {
  it("lists the pinned builds and their state", async () => {
    const r = await run([]);
    assert.equal(r.code, 0);
    assert.match(
      r.out(),
      new RegExp(`${PINNED.firefox.label}\\s+not installed`),
    );
    assert.match(
      r.out(),
      new RegExp(`${PINNED.chrome.label}\\s+not installed`),
    );
  });

  it("installs one browser, printing percentages when not on a terminal", async () => {
    const r = await run(["install", "firefox"]);
    assert.equal(r.code, 0);
    assert.match(r.out(), /Firefox 158\.0: 50%/);
    assert.match(r.out(), /installed at /);
    assert.match(
      (await run(["list"])).out(),
      new RegExp(`${PINNED.firefox.label}\\s+installed`),
    );
  });

  it("install without a name installs all", async () => {
    await run(["install"]);
    const listed = (await run(["list"])).out();
    assert.doesNotMatch(listed, /not installed/);
  });

  it("an unknown name exits 1", async () => {
    const r = await run(["install", "edge"]);
    assert.equal(r.code, 1);
    assert.equal(
      r.err(),
      'Unknown browser "edge". Choose firefox, chrome or all.\n',
    );
  });

  it("uninstall --unused removes only builds this version doesn't pin, and warns", async () => {
    await run(["install", "firefox"]);
    mkdirSync(path.join(cacheDir, "firefox", "stable_1.0"), {
      recursive: true,
    });
    const r = await run(["uninstall", "--unused"]);
    assert.equal(r.code, 0);
    assert.match(r.out(), /removed firefox stable_1\.0/);
    assert.match(r.out(), /other framework versions/);
    assert.deepEqual(readdirSync(path.join(cacheDir, "firefox")), [
      PINNED.firefox.buildId,
    ]);
  });

  it("uninstall <name> [--build <id>]", async () => {
    await run(["install", "firefox"]);
    assert.equal((await run(["uninstall", "firefox"])).code, 0);
    assert.equal(
      existsSync(path.join(cacheDir, "firefox", PINNED.firefox.buildId)),
      false,
    );
  });

  it("lists with the given env, not the process env", async () => {
    const saved = process.env.SAMURAI_FIREFOX_PATH;
    process.env.SAMURAI_FIREFOX_PATH = "/from/process";
    try {
      assert.doesNotMatch((await run(["list"])).out(), /\/from\/process/);
      assert.match(
        (await run(["list"], io({ SAMURAI_FIREFOX_PATH: "/from/io" }))).out(),
        /uses .*from.io \(environment variable\)/,
      );
    } finally {
      if (saved === undefined) delete process.env.SAMURAI_FIREFOX_PATH;
      else process.env.SAMURAI_FIREFOX_PATH = saved;
    }
  });

  it("install says where it downloads from when SAMURAI_BROWSERS_BASE_URL is set", async () => {
    const r = await run(
      ["install", "firefox"],
      io({ SAMURAI_BROWSERS_BASE_URL: "http://127.0.0.1:8080" }),
    );
    assert.match(r.out(), /^Downloading from http:\/\/127\.0\.0\.1:8080\n/);
    assert.doesNotMatch(
      (await run(["install", "chrome"])).out(),
      /Downloading from/,
    );
  });

  it("formats sizes", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(250 * 1024 * 1024), "250.0 MB");
  });
});
