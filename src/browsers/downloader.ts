import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  Browser as PuppeteerBrowser,
  Cache,
  detectBrowserPlatform,
  install,
  type BrowserPlatform,
} from "@puppeteer/browsers";

/** Written into a build folder once its download and unpack finished; a folder without it is unfinished */
export const COMPLETE_MARKER = ".samurai-complete";

/** One build folder in the cache, as the downloader names it ("firefox", "chrome", "chromedriver") */
export interface CachedBuild {
  browser: string;
  buildId: string;
  dir: string;
}

/** What the store needs to fetch and find builds; tests pass a fake */
export interface Downloader {
  /** undefined: no builds exist for this OS and architecture */
  platform(): string | undefined;
  /** The folder a build is, or would be, unpacked into */
  installDir(cacheDir: string, browser: string, buildId: string): string;
  executablePath(cacheDir: string, browser: string, buildId: string): string;
  install(
    cacheDir: string,
    browser: string,
    buildId: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void>;
  uninstall(cacheDir: string, browser: string, buildId: string): void;
  /** Removes a build's folder (its marker first) and any archive a killed download left behind */
  clean(cacheDir: string, browser: string, buildId: string): void;
  list(cacheDir: string): CachedBuild[];
}

/** Downloads from Mozilla and Google with @puppeteer/browsers; `baseUrl` (tests only) points it elsewhere */
export function puppeteerDownloader(
  baseUrl: string | undefined = process.env.SAMURAI_BROWSERS_BASE_URL,
): Downloader {
  const platform = (): BrowserPlatform => {
    const found = detectBrowserPlatform();
    if (!found)
      throw new Error(
        `No browser downloads for ${process.platform} ${process.arch}`,
      );
    return found;
  };
  const as = (browser: string) => browser as PuppeteerBrowser;
  return {
    platform: () => detectBrowserPlatform(),
    installDir: (cacheDir, browser, buildId) =>
      new Cache(cacheDir).installationDir(as(browser), platform(), buildId),
    executablePath: (cacheDir, browser, buildId) =>
      new Cache(cacheDir).computeExecutablePath({
        browser: as(browser),
        platform: platform(),
        buildId,
      }),
    async install(cacheDir, browser, buildId, onProgress) {
      await install({
        cacheDir,
        browser: as(browser),
        buildId,
        platform: platform(),
        ...(onProgress && { downloadProgressCallback: onProgress }),
        ...(baseUrl && { baseUrl }),
      });
    },
    uninstall: (cacheDir, browser, buildId) =>
      new Cache(cacheDir).uninstall(as(browser), platform(), buildId),
    clean(cacheDir, browser, buildId) {
      const cache = new Cache(cacheDir);
      const dir = cache.installationDir(as(browser), platform(), buildId);
      // The marker goes first: a removal that stops halfway leaves a folder that reads as missing
      rmSync(path.join(dir, COMPLETE_MARKER), { force: true });
      rmSync(dir, { recursive: true, force: true });
      // The archive is downloaded next to the build folders, as <buildId>-<file>
      const root = cache.browserRoot(as(browser));
      if (!existsSync(root)) return;
      for (const entry of readdirSync(root))
        if (entry.startsWith(`${buildId}-`))
          rmSync(path.join(root, entry), { recursive: true, force: true });
    },
    list: (cacheDir) =>
      new Cache(cacheDir)
        .getInstalledBrowsers()
        .map((b) => ({ browser: b.browser, buildId: b.buildId, dir: b.path })),
  };
}
