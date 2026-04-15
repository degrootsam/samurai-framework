import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { SupportedBrowser } from "../types/browser.js";
import { findBrowser } from "./browser-finder.js";
import path from "node:path";

const browserProfilePath: Record<SupportedBrowser, string> = {
  chrome: path.resolve("browsers/profiles/chrome/user.js"),
  firefox: path.resolve("browsers/profiles/firefox/user.js"),
};

const baseBrowserLaunchFlags: Record<SupportedBrowser, string[]> = {
  chrome: ["--headless", "--no-sandbox"],
  firefox: ["--headless", "--no-sandbox", "--no-remote"],
};

const defaultLaunchOptions: Record<SupportedBrowser, BrowserLaunchOptions> = {
  firefox: {
    port: 9222,
    profileDir: path.dirname(browserProfilePath.firefox),
  },
  chrome: {
    port: 9222,
    profileDir: path.dirname(browserProfilePath.chrome),
  },
};

const browserLaunchFlag = (
  browserName: SupportedBrowser,
  launchOptions: BrowserLaunchOptions,
) => {
  const { port = 9222, profileDir = path.dirname(browserProfilePath.firefox) } =
    launchOptions;
  const baseLaunchFlags = baseBrowserLaunchFlags[browserName];
  baseLaunchFlags.push(
    "--remote-debugging-port",
    port.toString(),
    "--profile",
    path.dirname(browserProfilePath.firefox),
  );
  return baseLaunchFlags;
};

const browserProfiles: Record<SupportedBrowser, string> = {
  chrome: "",
  firefox: `
    user_pref("devtools.debugger.remote-enabled", true);
    user_pref("devtools.debugger.prompt-connection", false);
    user_pref("devtools.chrome.enabled", true);
  `,
};

export interface BrowserLaunchOptions {
  port?: number;
  profileDir?: string;
}

export class Browser {
  private browserProc: ChildProcessWithoutNullStreams;

  constructor(browserProc: ChildProcessWithoutNullStreams) {
    this.browserProc = browserProc;
  }

  static async launch(
    browserName: SupportedBrowser,
    launchOptions: BrowserLaunchOptions = defaultLaunchOptions[browserName],
  ) {
    const browserLocation = findBrowser(browserName);
    checkBrowserProfile(browserName);

    const browserProc = spawn(
      browserLocation,
      browserLaunchFlag(browserName, launchOptions),
    );

    return new Promise((resolve, reject) => {
      browserProc.stdout.on("data", (data) => {
        console.log(`stdout: ${data}`);
        if (
          String(data).match(
            /!!!\scould\snot\sstart\sserver\son\sport\s(\d){4}/g,
          )
        ) {
          browserProc.kill();
          reject(`PORT ${launchOptions.port} is already in use!`);
        }
      });

      browserProc.stderr.on("data", (data) => {
        console.error(`stderr: ${data}`);

        if (browserName === "firefox") {
          const matches = String(data).match(
            /WebDriver\sBiDi\slistening\son\sws:\/\/(\d){1,3}.(\d){1,3}.(\d){1,3}.(\d){1,3}:(\d){4}/g,
          );
          if (Array.isArray(matches) && matches?.length > 0) {
            resolve(true);
          }
        } else if (browserName === "chrome") {
          const matches = String(data).match(
            /DevTools\slistening\son\sws:\/\/(\d){1,3}.(\d){1,3}.(\d){1,3}.(\d){1,3}:(\d){4}/g,
          );
          if (Array.isArray(matches) && matches.length > 0) {
            resolve(true);
          }
        }
      });

      browserProc.on("close", (code) => {
        console.log(`child process exited with code ${code}`);
      });

      setTimeout(() => {
        // If the promise didn't resovle after 10 seconds,
        // throw an error
        throw new Error(
          "We were unable to connect to the browser after 10 seconds.",
        );
      }, 10000);
    });
  }

  public close() {
    this.browserProc?.kill();
  }
}

function checkBrowserProfile(browserName: SupportedBrowser) {
  const profilePath = browserProfilePath[browserName];
  if (existsSync(profilePath)) {
    return;
  }
  createBrowserProfile(browserName, profilePath);
}

function createBrowserProfile(
  browserName: SupportedBrowser,
  profilePath: string,
) {
  mkdirSync(path.dirname(profilePath), { recursive: true });

  writeFileSync(profilePath, browserProfiles[browserName], {
    encoding: "utf8",
  });
}
