import {
  existsSync,
  lstatSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { browsersCacheDir } from "./cache-dir.js";
import { puppeteerDownloader, type Downloader } from "./downloader.js";
import {
  overrideOf,
  type Override,
  type OverrideSources,
} from "./overrides.js";
import {
  isManagedBrowser,
  LAUNCHABLE,
  PINNED,
  type ManagedBrowser,
} from "./pins.js";

/** Written into a build folder once its download and unpack finished; a folder without it is unfinished */
export const COMPLETE_MARKER = ".samurai-complete";

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
  /** Whether the framework can launch it yet */
  launchable: boolean;
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

/** Downloads the pinned build unless it is complete already; returns its executable */
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
  if (complete(dir))
    return downloader.executablePath(cacheDir, name, pin.buildId);
  const remove = () => {
    for (const part of parts(name))
      rmSync(downloader.installDir(cacheDir, part, pin.buildId), {
        recursive: true,
        force: true,
      });
  };
  // An unfinished folder from an earlier attempt would make the downloader refuse
  remove();
  try {
    for (const part of parts(name))
      await downloader.install(
        cacheDir,
        part,
        pin.buildId,
        part === name ? options.onProgress : undefined,
      );
  } catch (e) {
    remove();
    throw new Error(
      `Could not download ${pin.label}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  writeFileSync(path.join(dir, COMPLETE_MARKER), new Date().toISOString());
  return downloader.executablePath(cacheDir, name, pin.buildId);
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
    launchable: LAUNCHABLE.includes(name),
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

/** Removes a build (default: the pinned one); Chrome takes its chromedriver along */
export function uninstallBrowser(
  name: ManagedBrowser,
  buildId: string = PINNED[name].buildId,
  options: StoreOptions = {},
): void {
  const { cacheDir, downloader } = store(options);
  for (const part of parts(name)) {
    if (existsSync(downloader.installDir(cacheDir, part, buildId)))
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
