import assert from "node:assert";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { SupportedBrowser } from "../types/browser.js";

const supportedBrowsers: SupportedBrowser[] = ["chrome", "firefox"];

export function findBrowser(browserName: SupportedBrowser) {
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

  return browserLocation;
}

function tryFindBrowser(browserName: SupportedBrowser): string {
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
    try {
      const whereResults = execSync(`where /r ${dirPath} ${browserName}.exe`, {
        encoding: "utf8",
      });

      const results = whereResults.split(/\n/g);

      return results[0];
    } catch (err) {}
  };

  let result = undefined;

  for (const possibleDir of possibleDirs) {
    result = where(possibleDir);
    if (result) break;
  }

  if (!result) {
    throw new Error("'where' yielded no results");
  }
  return result;
}

const macBrowserPaths: Record<SupportedBrowser, string> = {
  chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  firefox: "/Applications/Firefox.app/Contents/MacOS/Firefox",
};

function findBrowserMac(browserName: SupportedBrowser): string {
  const checkPathExists = (path: string) => {
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
  const result = execSync(`which ${linuxBinaryNames[browserName]}`, {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.replace(/\n/g, "");
}
