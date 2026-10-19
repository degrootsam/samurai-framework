import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { browsersCacheDir } from "./cache-dir.js";
import {
  COMPLETE_MARKER,
  puppeteerDownloader,
  type Downloader,
} from "./downloader.js";
import {
  overrideOf,
  type Override,
  type OverrideSources,
} from "./overrides.js";
import { isManagedBrowser, PINNED, type ManagedBrowser } from "./pins.js";

export { COMPLETE_MARKER };

/** Each install downloads into its own `<cache>/.staging-<random>/` and moves the finished build into place */
const STAGING_PREFIX = ".staging-";
/** A staging folder this old belongs to an install that was killed */
const STALE_STAGING_MS = 24 * 60 * 60 * 1000;

export class BrowserNotInstalledError extends Error {
  constructor(
    readonly browser: ManagedBrowser,
    readonly label: string,
  ) {
    super(
      `${label} is not installed. Run: samurai browsers install ${browser}`,
    );
    this.name = "BrowserNotInstalledError";
  }
}

export interface StoreOptions {
  /** Default: `browsersCacheDir()` */
  cacheDir?: string;
  /** Default: @puppeteer/browsers */
  downloader?: Downloader;
}

export interface BrowserStatus {
  name: ManagedBrowser;
  label: string;
  buildId: string;
  /** unavailable: no download exists for this OS and architecture */
  state: "installed" | "missing" | "unavailable";
  executablePath?: string;
  /** A path set on purpose, which launches use instead of the managed build */
  override?: Override;
}

export interface InstalledBuild {
  name: ManagedBrowser;
  buildId: string;
  dir: string;
  sizeBytes: number;
  /** Pinned by this framework version */
  pinned: boolean;
}

const store = (options: StoreOptions = {}) => ({
  cacheDir: options.cacheDir ?? browsersCacheDir(),
  downloader: options.downloader ?? puppeteerDownloader(),
});

/** The cache folders one managed browser consists of */
const parts = (name: ManagedBrowser) =>
  name === "chrome" ? ["chrome", "chromedriver"] : [name];

const complete = (dir: string) => existsSync(path.join(dir, COMPLETE_MARKER));

function sizeOf(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? sizeOf(full) : lstatSync(full).size;
  }
  return total;
}

/** Removes staging folders that killed installs left behind; best effort */
function removeStaleStaging(cacheDir: string) {
  if (!existsSync(cacheDir)) return;
  for (const entry of readdirSync(cacheDir)) {
    if (!entry.startsWith(STAGING_PREFIX)) continue;
    const dir = path.join(cacheDir, entry);
    try {
      if (Date.now() - statSync(dir).mtimeMs > STALE_STAGING_MS)
        rmSync(dir, { recursive: true, force: true });
    } catch {
      // another process may be removing it too
    }
  }
}

/**
 * Downloads the pinned build unless it is complete already; returns its executable. The download goes into a
 * private staging folder and is moved into place once complete, so two installs at once do not break each other.
 */
export async function installBrowser(
  name: ManagedBrowser,
  options: StoreOptions & {
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<string> {
  const { cacheDir, downloader } = store(options);
  const pin = PINNED[name];
  if (!downloader.platform())
    throw new Error(
      `${pin.label} has no download for ${process.platform} ${process.arch}`,
    );
  const dir = downloader.installDir(cacheDir, name, pin.buildId);
  const exe = () => downloader.executablePath(cacheDir, name, pin.buildId);
  if (complete(dir)) return exe();
  let staging: string | undefined;
  try {
    removeStaleStaging(cacheDir);
    mkdirSync(cacheDir, { recursive: true });
    staging = mkdtempSync(path.join(cacheDir, STAGING_PREFIX));
    for (const part of parts(name))
      await downloader.install(
        staging,
        part,
        pin.buildId,
        part === name ? options.onProgress : undefined,
      );
    writeFileSync(
      path.join(
        downloader.installDir(staging, name, pin.buildId),
        COMPLETE_MARKER,
      ),
      new Date().toISOString(),
    );
    // The part holding the marker moves last, so the build counts as complete only once every part is in place
    for (const part of parts(name).reverse()) {
      // Another install finished first
      if (complete(dir)) return exe();
      // An unfinished folder from an earlier attempt would block the move
      downloader.clean(cacheDir, part, pin.buildId);
      const target = downloader.installDir(cacheDir, part, pin.buildId);
      mkdirSync(path.dirname(target), { recursive: true });
      try {
        renameSync(downloader.installDir(staging, part, pin.buildId), target);
      } catch (e) {
        if (complete(dir)) return exe();
        throw e;
      }
    }
  } catch (e) {
    throw new Error(
      `Could not download ${pin.label}: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
  return exe();
}

/** The pinned build of `name`: whether it is there, and any path set instead of it */
export function statusOf(
  name: ManagedBrowser,
  options: StoreOptions & OverrideSources = {},
): BrowserStatus {
  const { cacheDir, downloader } = store(options);
  const pin = PINNED[name];
  const override = overrideOf(name, options);
  const base = {
    name,
    label: pin.label,
    buildId: pin.buildId,
    ...(override && { override }),
  };
  if (!downloader.platform()) return { ...base, state: "unavailable" };
  if (!complete(downloader.installDir(cacheDir, name, pin.buildId)))
    return { ...base, state: "missing" };
  return {
    ...base,
    state: "installed",
    executablePath: downloader.executablePath(cacheDir, name, pin.buildId),
  };
}

/** The pinned build's executable; throws BrowserNotInstalledError when it isn't complete */
export function managedExecutable(
  name: ManagedBrowser,
  options: StoreOptions = {},
): string {
  const status = statusOf(name, { ...options, env: {} });
  if (status.state !== "installed")
    throw new BrowserNotInstalledError(name, status.label);
  return status.executablePath!;
}

/** The chromedriver installed with the pinned Chrome; throws BrowserNotInstalledError when Chrome's install isn't complete */
export function managedChromedriver(options: StoreOptions = {}): string {
  const { cacheDir, downloader } = store(options);
  const status = statusOf("chrome", { ...options, env: {} });
  if (status.state !== "installed")
    throw new BrowserNotInstalledError("chrome", status.label);
  return downloader.executablePath(
    cacheDir,
    "chromedriver",
    PINNED.chrome.buildId,
  );
}

/** The folder the pinned build of `name` is, or would be, installed in */
export function managedBuildDir(
  name: ManagedBrowser,
  options: StoreOptions = {},
): string {
  const { cacheDir, downloader } = store(options);
  return downloader.installDir(cacheDir, name, PINNED[name].buildId);
}

/** Removes a build (default: the pinned one); Chrome takes its chromedriver along */
export function uninstallBrowser(
  name: ManagedBrowser,
  buildId: string = PINNED[name].buildId,
  options: StoreOptions = {},
): void {
  const { cacheDir, downloader } = store(options);
  const root = path.resolve(cacheDir);
  const dirs = parts(name).map((part) => ({
    part,
    dir: downloader.installDir(cacheDir, part, buildId),
  }));
  if (
    /[/\\]|\.\./.test(buildId) ||
    dirs.some(({ dir }) => !path.resolve(dir).startsWith(root + path.sep))
  )
    throw new Error(`Invalid build id "${buildId}"`);
  for (const { part, dir } of dirs) {
    if (!existsSync(dir)) continue;
    // Without its marker a build that is only partly removed reads as missing
    rmSync(path.join(dir, COMPLETE_MARKER), { force: true });
    downloader.uninstall(cacheDir, part, buildId);
  }
}

/** Every Firefox and Chrome build in the cache, also those other framework versions pinned */
export function listInstalled(options: StoreOptions = {}): InstalledBuild[] {
  const { cacheDir, downloader } = store(options);
  return downloader
    .list(cacheDir)
    .filter((b) => isManagedBrowser(b.browser))
    .map((b) => {
      const name = b.browser as ManagedBrowser;
      return {
        name,
        buildId: b.buildId,
        dir: b.dir,
        sizeBytes: sizeOf(b.dir),
        pinned: PINNED[name].buildId === b.buildId,
      };
    });
}
