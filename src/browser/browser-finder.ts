import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { SupportedBrowser } from "../types/browser.js";
import logger from "../logger/index.js";

/** The only browser the system search knows; Chrome is launched from the build SAMURAI downloads */
type FindableBrowser = "firefox";
const supportedBrowsers: FindableBrowser[] = ["firefox"];
const isFindable = (name: SupportedBrowser): name is FindableBrowser =>
  (supportedBrowsers as string[]).includes(name);
const macBrowserPaths: Record<FindableBrowser, string> = {
  firefox: "/Applications/Firefox.app/Contents/MacOS/Firefox",
};

/** @deprecated Launches use the builds SAMURAI downloads (`samurai browsers install`); removed in a later major */
export function findBrowser(browserName: SupportedBrowser) {
  logger.verbose("Checking install location for %s", browserName);
  if (!isFindable(browserName)) {
    throw new Error(
      "This browser is not supported. Supported browsers include: " +
        supportedBrowsers.join(", "),
    );
  }

  let browserLocation: string;
  try {
    browserLocation = tryFindBrowser(browserName);
  } catch (err) {
    throw Object.assign(
      new Error(
        `Cannot find browser ${browserName} on this machine! Is it installed?`,
      ),
      { cause: err },
    );
  }

  logger.verbose("Browser found at: %s", browserLocation);

  return browserLocation;
}

function tryFindBrowser(browserName: FindableBrowser): string {
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

function findBrowserWindows(browserName: FindableBrowser): string {
  // Function to prevent search the entire file system
  // We'll only try the most common paths
  const possibleDirs = ["Program Files", "Program Files (x86)"];

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

function findBrowserMac(browserName: FindableBrowser): string {
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

const linuxBinaryNames: Record<FindableBrowser, string> = {
  firefox: "firefox",
};

function findBrowserLinux(browserName: FindableBrowser): string {
  const command = `which ${linuxBinaryNames[browserName]}`;
  logger.debug("Running command: %s", command);
  const result = execSync(command, {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.replace(/\n/g, "");
}
