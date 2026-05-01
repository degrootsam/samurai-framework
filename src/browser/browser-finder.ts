import assert from "node:assert";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { SupportedBrowser } from "../types/browser.js";
import logger from "../logger/index.js";

const supportedBrowsers: SupportedBrowser[] = ["chrome", "firefox"];
const macBrowserPaths: Record<SupportedBrowser, string> = {
  chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  firefox: "/Applications/Firefox.app/Contents/MacOS/Firefox",
};

export function findBrowser(browserName: SupportedBrowser) {
  logger.verbose("Checking install location for %s", browserName);
  if (!supportedBrowsers.includes(browserName)) {
    throw new Error(
      "This browser is not supported. Supported browsers include: " +
        supportedBrowsers.join(", "),
    );
  }

  let browserLocation = "";
  const notFoundMsg = `Cannot find browser ${browserName} on this machine! Is it installed?`;
  try {
    browserLocation = tryFindBrowser(browserName);
  } catch (err) {
    throw new Error(notFoundMsg);
  }

  assert(browserLocation, notFoundMsg);
  logger.verbose("Browser found at: %s", browserLocation);

  return browserLocation;
}

function tryFindBrowser(browserName: SupportedBrowser): string {
  logger.debug("Current platform: %s", process.platform);
  switch (process.platform) {
    case "win32":
      return findBrowserWindows(browserName);
    case "darwin":
      return findBrowserMac(browserName);
    case "linux":
      return findBrowserLinux(browserName);
    default:
      throw new Error("This platform is not supported");
  }
}

function findBrowserWindows(browserName: SupportedBrowser): string {
  // Function to prevent search the entire file system
  // We'll only try the most common paths
  const possibleDirs = ["Program\ Files", "Program\ Files (x86)"];

  const where = (dirPath: string) => {
    const command: string = `where /r ${dirPath} ${browserName}.exe`;
    try {
      logger.verbose("Running command: %s", command);

      const whereResults = execSync(command, {
        encoding: "utf8",
      });
      logger.debug("Command results: \n", whereResults);
      const results = whereResults.split(/\n/g);
      return results[0];
    } catch (error) {
      logger.verbose("Error while executing %s", command, { error });
    }
  };

  let result = undefined;

  for (const possibleDir of possibleDirs) {
    logger.debug("Checking directory: %s", possibleDir);
    result = where(possibleDir);
    if (result) break;
  }

  if (!result) {
    throw new Error("'where' yielded no results");
  }
  return result;
}

function findBrowserMac(browserName: SupportedBrowser): string {
  const checkPathExists = (path: string) => {
    logger.debug("Checking path: %s", path);
    const exists = existsSync(path);
    if (!exists) {
      throw new Error(`Did not find ${browserName} at ${path}`);
    }
    return path;
  };
  return checkPathExists(macBrowserPaths[browserName]);
}

const linuxBinaryNames: Record<SupportedBrowser, string> = {
  chrome: "google-chrome",
  firefox: "firefox",
};

function findBrowserLinux(browserName: SupportedBrowser): string {
  const command = `which ${linuxBinaryNames[browserName]}`;
  logger.debug("Running command: %s", command);
  const result = execSync(command, {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.replace(/\n/g, "");
}
