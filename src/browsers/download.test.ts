import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Browser, Cache, detectBrowserPlatform } from "@puppeteer/browsers";
import { puppeteerDownloader } from "./downloader.js";
import { PINNED } from "./pins.js";
import { COMPLETE_MARKER, installBrowser } from "./store.js";

const hasZip = (() => {
  try {
    execFileSync("zip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let dir: string;
let server: Server;
let baseUrl: string;
const buildId = PINNED.chrome.buildId;

/** A zip whose executable sits where @puppeteer/browsers looks for it */
function zipFor(browser: Browser): Buffer {
  const platform = detectBrowserPlatform()!;
  const scratch = mkdtempSync(path.join(dir, "zip-"));
  const cache = new Cache(scratch);
  const exe = cache.computeExecutablePath({ browser, platform, buildId });
  const relative = path.relative(
    cache.installationDir(browser, platform, buildId),
    exe,
  );
  const root = path.join(scratch, "root");
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), "#!/bin/sh\n", { mode: 0o755 });
  const zip = path.join(scratch, "out.zip");
  execFileSync("zip", ["-qr", zip, "."], { cwd: root });
  return readFileSync(zip);
}

before(async () => {
  if (!hasZip) return;
  dir = mkdtempSync(path.join(tmpdir(), "samurai-download-"));
  const chrome = zipFor(Browser.CHROME);
  const driver = zipFor(Browser.CHROMEDRIVER);
  server = createServer((req, res) => {
    const name = path.basename(req.url ?? "");
    const body = name.startsWith("chromedriver-") ? driver : chrome;
    res.writeHead(200, { "content-length": body.length });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("installBrowser with @puppeteer/browsers", () => {
  it(
    "downloads, unpacks and marks Chrome and its chromedriver",
    { skip: !hasZip && "zip is not installed" },
    async () => {
      const cacheDir = path.join(dir, "cache");
      let reported = false;
      const exe = await installBrowser("chrome", {
        cacheDir,
        downloader: puppeteerDownloader(baseUrl),
        onProgress: () => (reported = true),
      });
      assert.ok(existsSync(exe));
      assert.ok(reported);
      const platform = detectBrowserPlatform()!;
      const cache = new Cache(cacheDir);
      const chromeDir = cache.installationDir(
        Browser.CHROME,
        platform,
        buildId,
      );
      assert.ok(existsSync(path.join(chromeDir, COMPLETE_MARKER)));
      assert.ok(
        existsSync(
          cache.installationDir(Browser.CHROMEDRIVER, platform, buildId),
        ),
      );
    },
  );
});
