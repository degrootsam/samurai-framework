import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { SupportedBrowser } from "../types/browser.js";
import { findBrowser } from "./browser-finder.js";
import { existsSync, mkdirSync, writeFile, writeFileSync } from "node:fs";
import { profile } from "node:console";

const browserLaunchFlags: Record<SupportedBrowser, string[]> = {
  chrome: ["--remote-debugging-port=9222", "--headless", "--no-sandbox"],
  firefox: [
    "--remote-debugging-port=9222",
    "--headless",
    "--no-sandbox",
    "--no-remote",
    "--profile=/tmp/samurai-firefox",
  ],
};

const browserProfilePath: Record<SupportedBrowser, string> = {
  chrome: "/tmp/samurai-chrome",
  firefox: "/tmp/samurai-firefox",
};

export class Browser {
  private browserProc: ChildProcessWithoutNullStreams;

  constructor(browserProc: ChildProcessWithoutNullStreams) {
    this.browserProc = browserProc;
  }

  public connect() {
    this.tryConnectToWebsocket();
  }

  private async tryConnectToWebsocket() {}

  private waitForWebsocketConnection() {}

  static async launch(browserName: SupportedBrowser) {
    const browserLocation = findBrowser(browserName);
    checkBrowserProfile(browserName);
    const browserProc = spawn(browserLocation, browserLaunchFlags[browserName]);

    browserProc.stdout.on("data", (data) => {
      console.log(`stdout: ${data}`);
    });

    browserProc.stderr.on("data", (data) => {
      console.error(`stderr: ${data}`);
    });

    browserProc.on("close", (code) => {
      console.log(`child process exited with code ${code}`);
    });

    return new Browser(browserProc);
  }

  public close() {
    this.browserProc?.disconnect();
  }
}

const FIREFOX_PROFILE = `
  user_pref("devtools.debugger.remote-enabled", true);
  user_pref("devtools.debugger.prompt-connection", false);
  user_pref("devtools.chrome.enabled", true);
`;

function checkBrowserProfile(browserName: SupportedBrowser) {
  const profilePath = browserProfilePath[browserName];
  if (existsSync(profilePath)) {
    return;
  }
  createBrowserProfile(profilePath);
}

function createBrowserProfile(profilePath: string) {
  mkdirSync(profilePath, { recursive: true });

  writeFileSync(`${profilePath}/user.js`, FIREFOX_PROFILE, {
    encoding: "utf8",
  });
}
