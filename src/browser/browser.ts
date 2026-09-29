import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { SupportedBrowser } from "../types/browser.js";
import { findBrowser } from "./browser-finder.js";
import path from "node:path";
import { BiDiConnector } from "../transport/bidi-connection.js";
import Page from "./page.js";
import type { BiDiCommands } from "../types/bidi.js";
import logger from "../logger/index.js";
import type {
  CookieFilter,
  PartialCookie,
  PartitionDescriptor,
} from "../types/bidi-modules/storage.js";

/** Time (ms) to wait for Firefox to answer browser.close before killing the process */
const BROWSER_CLOSE_GRACE = 2000;

const browserProfilePath: Record<SupportedBrowser, string> = {
  // chrome: path.resolve("browsers/profiles/chrome"),
  firefox: path.resolve("browsers/profiles/firefox/user.js"),
};

const baseBrowserLaunchFlags: Record<SupportedBrowser, string[]> = {
  // chrome: [],
  firefox: ["--no-sandbox", "--no-remote"],
};

const defaultLaunchOptions: Record<SupportedBrowser, BrowserLaunchOptions> = {
  firefox: {
    port: 9222,
    profileDir: path.dirname(browserProfilePath.firefox),
    headless: true,
  },
  // chrome: {
  //   port: 9222,
  //   profileDir: path.dirname(browserProfilePath.chrome),
  //   headless: true,
  // },
};

const regexPrefix: Record<SupportedBrowser, RegExp> = {
  firefox: /WebDriver\sBiDi\slistening\son\s/,
  // chrome: /DevTools\slistening\son/,
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
  baseLaunchFlags.push(`--remote-debugging-port=${port}`);

  switch (browserName) {
    // case "chrome":
    //   baseLaunchFlags.push(`--user-data-dir=${profileDir}`);
    // break;
    case "firefox":
      baseLaunchFlags.push("--profile", profileDir);
      break;
  }
  logger.verbose("Launch flags for browser %s: ", browserName, {
    baseLaunchFlags,
  });
  return baseLaunchFlags;
};

// On macOS a spawned browser is attributed to the terminal, which is denied access to
// ~/Library/Application Support/Firefox (profiles.ini). Point Firefox at a local app data dir instead.
const browserAppDataPath: Record<SupportedBrowser, string> = {
  firefox: path.resolve("browsers/app-data/firefox"),
};

const browserLaunchEnv = (browserName: SupportedBrowser) => {
  const appDataPath = browserAppDataPath[browserName];
  mkdirSync(appDataPath, { recursive: true });
  logger.debug("Using app data dir for %s: %s", browserName, appDataPath);

  switch (browserName) {
    case "firefox":
      return { MOZ_APP_DATA: appDataPath };
  }
};

const browserProfiles: Record<SupportedBrowser, string> = {
  // chrome: "",
  firefox: `
    user_pref("devtools.debugger.remote-enabled", true);
    user_pref("devtools.debugger.prompt-connection", false);
    user_pref("devtools.chrome.enabled", true);
  `,
};

// Firefox logs "WebDriver BiDi listening on ws://<host>:<port>" without the endpoint path
const browserWsPath: Record<SupportedBrowser, string> = {
  firefox: "/session",
};

const browserWsRegex: Record<SupportedBrowser, RegExp> = {
  firefox: /ws:\/\/(\d){1,3}.(\d){1,3}.(\d){1,3}.(\d){1,3}:(\d){4}/g,
  // chrome:
  //   /ws:\/\/(\d){1,3}.(\d){1,3}.(\d){1,3}.(\d){1,3}:(\d){4}\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
};

export interface BrowserLaunchOptions {
  /** Which port to use for the WebDeveloper tools */
  port: number;
  /** Firefox only */
  profileDir: string;
  /** Start the browser in headless mode or in UI mode */
  headless: boolean;
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
    /** Aborting kills the browser process and rejects the launch */
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    logger.verbose("Trying to launch browser %s", browserName);
    const browserLocation = findBrowser(browserName);
    logger.debug("Found browser install location at: %s", browserLocation);
    checkBrowserProfile(browserName);

    logger.verbose("Trying to spawn %s process", browserName);

    const browserProc = spawn(
      browserLocation,
      browserLaunchFlag(browserName, launchOptions),
      { env: { ...process.env, ...browserLaunchEnv(browserName) } },
    );

    return new Promise<{ browser: Browser; page: Page }>((resolve, reject) => {
      const onUnexpectedClose = (code: number | null) => {
        reject(
          new Error(`Browser process exited unexpectedly with code ${code}`),
        );
      };

      browserProc.on("close", onUnexpectedClose);

      const onAbort = () => {
        logger.verbose("Launch of %s aborted, killing process", browserName);
        browserProc.kill();
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      browserProc.stdout.on("data", (data: any) => {
        logger.debug(`${browserName} stdout: ${data}`);
        if (
          String(data).match(
            /!!!\scould\snot\sstart\sserver\son\sport\s(\d){4}/g,
          )
        ) {
          browserProc.kill();
          reject(`PORT ${launchOptions.port} is already in use!`);
        }
      });

      browserProc.stderr.on("data", async (data: any) => {
        logger.error(`${browserName} stderr: ${data}`);

        const urlMatch = String(data).match(browserWsRegex[browserName]);
        console.log({ urlMatch });
        if (!Array.isArray(urlMatch) || urlMatch.length === 0) {
          return;
        }
        // Killing the process mid-handshake rejects pending BiDi calls; surface that via reject
        // instead of an unhandled rejection from this async listener
        try {
          let url = urlMatch[0] + browserWsPath[browserName];
          logger.verbose("Websocket URL match: %s", url);
          const biDiConnector = await BiDiConnector.connect(url);
          logger.verbose("Starting new session");
          const status = await biDiConnector.send("session.status", {});
          logger.verbose("Session status", status);
          await biDiConnector.send("session.new", {
            capabilities: {},
          });
          logger.verbose("Session started successfully");

          const sessionEvents = ["browsingContext.load"];
          logger.verbose("Subscribing to session events");
          logger.debug("Session events: ", { sessionEvents });
          await biDiConnector.send("session.subscribe", {
            events: sessionEvents,
          });
          logger.verbose("Successfully subscribed to session events");

          const browser = new Browser({ browserProc, biDiConnector });
          logger.verbose("Requesting current browser tree");
          const browserTree = await biDiConnector.send(
            "browsingContext.getTree",
            {},
          );
          logger.verbose("Received current browser tree");
          logger.debug("Browser tree: ", { browserTree });

          const pageContext = browserTree.contexts[0];

          let page = undefined;

          if (pageContext) {
            page = new Page(biDiConnector, pageContext.context);
          } else {
            page = await browser.newPage({ type: "tab" });
          }
          browserProc.off("close", onUnexpectedClose);
          signal?.removeEventListener("abort", onAbort);
          resolve({
            browser,
            page,
          });
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /** Closes the browser via BiDi browser.close, then makes sure the process has exited */
  public async close() {
    if (this.browserProc.exitCode !== null || this.browserProc.signalCode) {
      this.biDiConnector.kill();
      return;
    }
    const exited = new Promise((resolve) =>
      this.browserProc.once("exit", resolve),
    );
    try {
      // Firefox may exit without answering; a lost reply must not hold up teardown
      await Promise.race([
        this.biDiConnector.send("browser.close", {}),
        sleep(BROWSER_CLOSE_GRACE, undefined, { ref: false }),
      ]);
    } catch {
      // browser may already be shutting down
    }
    this.biDiConnector.kill();
    this.browserProc.kill();
    await exited;
  }

  /** Alias of close() */
  public async kill() {
    await this.close();
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

  public async getCookie(filter: CookieFilter, partition: PartitionDescriptor) {
    return await this.biDiConnector.send("storage.getCookies", {
      filter,
      partition,
    });
  }

  public async setCookie(
    cookie: PartialCookie,
    partition?: PartitionDescriptor,
  ) {
    return await this.biDiConnector.send("storage.setCookie", {
      partition,
      cookie,
    });
  }
}

function checkBrowserProfile(browserName: SupportedBrowser) {
  logger.verbose("Checking browser profile for: %s", browserName);
  const profilePath = browserProfilePath[browserName];
  if (!profilePath) {
    logger.verbose("No browser profile path declared, skipping...");
    return;
  }
  if (existsSync(profilePath)) {
    logger.verbose("Browser profile already exists at: %s", profilePath);
    return;
  }
  logger.verbose("No browser profile created yet for %s", browserName);

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
