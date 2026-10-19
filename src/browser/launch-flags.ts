import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browsersDir } from "../config/config.js";
import logger from "../logger/index.js";
import type { SupportedBrowser } from "../types/browser.js";

export interface BrowserLaunchOptions {
  /** Which port to use for the WebDeveloper tools */
  port: number;
  /** The browser profile folder: user.js goes in it for Firefox, Chrome's user data for Chrome */
  profileDir: string;
  /** Start the browser in headless mode or in UI mode */
  headless: boolean;
}

const browserProfilePath = (browserName: SupportedBrowser): string =>
  path.join(browsersDir(), "profiles", browserName, "user.js");

const baseBrowserLaunchFlags: Record<SupportedBrowser, string[]> = {
  // Chrome is started by its chromedriver: see chrome-launch.ts
  chrome: [],
  firefox: ["--no-sandbox", "--no-remote"],
};

/** Read when a browser launches, since the profile folder depends on the active project */
export const defaultLaunchOptions = (
  browserName: SupportedBrowser,
): BrowserLaunchOptions => ({
  port: 9222,
  profileDir: path.dirname(browserProfilePath(browserName)),
  headless: true,
});

export const browserLaunchFlag = (
  browserName: SupportedBrowser,
  launchOptions: Partial<BrowserLaunchOptions>,
) => {
  const defLaunchOpts = defaultLaunchOptions(browserName);
  const port = launchOptions.port || defLaunchOpts.port;
  const profileDir = launchOptions.profileDir || defLaunchOpts.profileDir;
  const headless = launchOptions.headless ?? defLaunchOpts.headless;

  const baseLaunchFlags = [...baseBrowserLaunchFlags[browserName]];

  if (headless) {
    baseLaunchFlags.push("--headless");
  }
  baseLaunchFlags.push(`--remote-debugging-port=${port}`);

  switch (browserName) {
    case "chrome":
      break;
    case "firefox":
      baseLaunchFlags.push("--profile", profileDir);
      // The home page (about:home) is privileged: BiDi refuses commands such as setViewport on it
      baseLaunchFlags.push("about:blank");
      break;
  }
  logger.verbose("Launch flags for browser %s: ", browserName, {
    baseLaunchFlags,
  });
  return baseLaunchFlags;
};

// On macOS a spawned browser is attributed to the terminal, which is denied access to
// ~/Library/Application Support/Firefox (profiles.ini). Point Firefox at a local app data dir instead.
const browserAppDataPath = (browserName: SupportedBrowser): string =>
  path.join(browsersDir(), "app-data", browserName);

/** Env added to a browser's process */
export const browserLaunchEnv = (
  browserName: SupportedBrowser,
  appDataPath: string = browserAppDataPath(browserName),
): Record<string, string> => {
  mkdirSync(appDataPath, { recursive: true });
  logger.debug("Using app data dir for %s: %s", browserName, appDataPath);

  switch (browserName) {
    case "chrome":
      return {};
    case "firefox":
      // The project profile may have been opened by a newer Firefox (the system one, before 0.6);
      // without this Firefox refuses to start on it
      return { MOZ_APP_DATA: appDataPath, MOZ_ALLOW_DOWNGRADE: "1" };
  }
};

const browserProfiles: Record<SupportedBrowser, string> = {
  // Chrome needs no prefs file; its profile folder is created at launch
  chrome: "",
  firefox: `
    user_pref("devtools.debugger.remote-enabled", true);
    user_pref("devtools.debugger.prompt-connection", false);
    user_pref("devtools.chrome.enabled", true);
    // The home page (about:home) is privileged: BiDi refuses commands such as setViewport on it
    user_pref("browser.startup.page", 0);
    user_pref("browser.startup.homepage", "about:blank");
    user_pref("browser.newtabpage.enabled", false);
  `,
};

/** Writes the browser's user.js unless it already holds the current prefs; an outdated one is replaced */
export function ensureBrowserProfile(
  browserName: SupportedBrowser,
  profilePath: string | undefined = browserProfilePath(browserName),
) {
  logger.verbose("Checking browser profile for: %s", browserName);
  if (!profilePath) {
    logger.verbose("No browser profile path declared, skipping...");
    return;
  }
  if (existsSync(profilePath)) {
    if (readFileSync(profilePath, "utf8") === browserProfiles[browserName]) {
      logger.verbose("Browser profile is up to date at: %s", profilePath);
      return;
    }
    logger.verbose(
      "Browser profile at %s is outdated, rewriting it",
      profilePath,
    );
  } else {
    logger.verbose("No browser profile created yet for %s", browserName);
  }

  createBrowserProfile(browserName, profilePath);
}

function createBrowserProfile(
  browserName: SupportedBrowser,
  profilePath: string,
) {
  logger.verbose(
    "Creating browser profile for %s at %s",
    browserName,
    profilePath,
  );
  mkdirSync(path.dirname(profilePath), { recursive: true });

  writeFileSync(profilePath, browserProfiles[browserName], {
    encoding: "utf8",
  });
  logger.verbose("Browser profile created");
}
