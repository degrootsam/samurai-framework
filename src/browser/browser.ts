import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { SupportedBrowser } from "../types/browser.js";
import { findBrowser } from "./browser-finder.js";
import path from "node:path";
import { BiDiConnector } from "../transport/bidi-connection.js";
import Page from "./page.js";
import { type BiDiCommands } from "../types/bidi.js";

const browserProfilePath: Record<SupportedBrowser, string> = {
  chrome: "",
  firefox: path.resolve("browsers/profiles/firefox/user.js"),
};

const baseBrowserLaunchFlags: Record<SupportedBrowser, string[]> = {
  chrome: ["--no-sandbox"],
  firefox: ["--no-sandbox", "--no-remote"],
};

const defaultLaunchOptions: Record<SupportedBrowser, BrowserLaunchOptions> = {
  firefox: {
    port: 9222,
    profileDir: path.dirname(browserProfilePath.firefox),
    headless: true,
  },
  chrome: {
    port: 9222,
    profileDir: path.dirname(browserProfilePath.chrome),
    headless: true,
  },
};

const regexPrefix: Record<SupportedBrowser, RegExp> = {
  firefox: /WebDriver\sBiDi\slistening\son\s/,
  chrome: /DevTools\slistening\son/,
};

const browserLaunchFlag = (
  browserName: SupportedBrowser,
  launchOptions: Partial<BrowserLaunchOptions>,
) => {
  const defLaunchOpts = defaultLaunchOptions[browserName];
  const port = launchOptions.port || defLaunchOpts.port;
  const profileDir = launchOptions.profileDir || defLaunchOpts.profileDir;
  const headless = launchOptions.headless ?? defLaunchOpts.headless;

  const baseLaunchFlags = [...baseBrowserLaunchFlags[browserName]];

  if (headless) {
    baseLaunchFlags.push("--headless");
  }
  baseLaunchFlags.push("--remote-debugging-port", port.toString());
  if (browserName === "firefox") {
    baseLaunchFlags.push("--profile", profileDir);
  }
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

const browserWsPath: Record<SupportedBrowser, string> = {
  firefox: "/session",
  chrome: "",
};

export interface BrowserLaunchOptions {
  /** Which port to use for the WebDeveloper tools */
  port: number;
  /** Firefox only */
  profileDir: string;
  /** Start the browser in headless mode or in UI mode */
  headless: boolean;
}

interface NewPageOptions {
  type: "tab" | "window";
  /** Run this page in the background */
  background?: boolean;
  /** A user context represents a collection of zero or more top-level traversables within a remote end.
   * Each user context has an associated storage partition, so that remote end data is not shared between different user contexts.
   *
   * See more: https://w3c.github.io/webdriver-bidi/#user-context
   */
  userContext?: string;
}

export class Browser {
  private browserProc: ChildProcessWithoutNullStreams;
  private biDiConnector: BiDiConnector;

  constructor({
    browserProc,
    biDiConnector,
  }: {
    browserProc: ChildProcessWithoutNullStreams;
    biDiConnector: BiDiConnector;
  }) {
    this.browserProc = browserProc;
    this.biDiConnector = biDiConnector;
  }

  static async launch(
    browserName: SupportedBrowser,
    launchOptions: Partial<BrowserLaunchOptions> = defaultLaunchOptions[
      browserName
    ],
  ) {
    const browserLocation = findBrowser(browserName);
    checkBrowserProfile(browserName);

    const browserProc = spawn(
      browserLocation,
      browserLaunchFlag(browserName, launchOptions),
    );

    return new Promise<{ browser: Browser; page: Page }>((resolve, reject) => {
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

      browserProc.stderr.on("data", async (data) => {
        console.error(`stderr: ${data}`);

        const urlMatch = String(data).match(
          /ws:\/\/(\d){1,3}.(\d){1,3}.(\d){1,3}.(\d){1,3}:(\d){4}/g,
        );
        const prefixMatch = String(data).match(regexPrefix[browserName]);
        if (
          Array.isArray(urlMatch) &&
          Array.isArray(prefixMatch) &&
          urlMatch.length > 0 &&
          prefixMatch.length > 0
        ) {
          let url = urlMatch[0] + browserWsPath[browserName];
          const biDiConnector = await BiDiConnector.connect(url);

          await biDiConnector.send("session.new", {
            capabilities: {},
          });

          await biDiConnector.send("session.subscribe", {
            events: ["browsingContext.load"],
          });

          const browser = new Browser({ browserProc, biDiConnector });
          const browserTree = await biDiConnector.send(
            "browsingContext.getTree",
            {},
          );

          const pageContext = browserTree.contexts[0];

          let page = undefined;

          if (pageContext) {
            page = new Page(biDiConnector, pageContext.context);
          } else {
            page = await browser.newPage({ type: "tab" });
          }
          resolve({
            browser,
            page,
          });
        }
      });

      browserProc.on("close", (code) => {
        reject(
          new Error(`Browser process exited unexpectedly with code ${code}`),
        );
      });
    });
  }

  public close() {
    this.browserProc?.kill();
  }

  public async newPage({
    type,
    background,
    userContext,
  }: BiDiCommands["browsingContext.create"]["params"]): Promise<Page> {
    const createBrowserContext = await this.biDiConnector.send(
      "browsingContext.create",
      {
        type,
        background,
        userContext,
      },
    );
    console.log({ createBrowserContext });
    return new Page(this.biDiConnector, "");
  }
}

function checkBrowserProfile(browserName: SupportedBrowser) {
  const profilePath = browserProfilePath[browserName];
  if (!profilePath) return;
  if (existsSync(profilePath)) return;

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
