import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { SupportedBrowser } from "../types/browser.js";
import { findBrowser } from "./browser-finder.js";
import path from "node:path";
import { BiDiConnector } from "../transport/bidi-connection.js";
import Page from "./page.js";
import { BrowserContext, type ContextHost } from "./browser-context.js";
import type { UserPromptHandler } from "../types/bidi-modules/session.js";
import { validateEmulation, type EmulationOptions } from "./emulation.js";
import { prepareDownloadsDir, removeIfEmpty } from "./downloads-dir.js";
import type { BiDiCommands } from "../types/bidi.js";
import logger from "../logger/index.js";
import { browsersDir, projectDir, readConfig } from "../config/config.js";
import type {
  CookieFilter,
  PartialCookie,
  PartitionDescriptor,
} from "../types/bidi-modules/storage.js";

/**
 * Sent with session.new. With "ignore" the browser leaves a JavaScript dialog open and reports it
 * (`browsingContext.userPromptOpened`), so the framework decides how to answer instead of the browser.
 */
export const SESSION_CAPABILITIES = {
  alwaysMatch: { unhandledPromptBehavior: { default: "ignore" } },
};

/** Time (ms) to wait for Firefox to answer browser.close before killing the process */
const BROWSER_CLOSE_GRACE = 2000;

const browserProfilePath = (browserName: SupportedBrowser): string =>
  path.join(browsersDir(), "profiles", browserName, "user.js");

const baseBrowserLaunchFlags: Record<SupportedBrowser, string[]> = {
  // chrome: [],
  firefox: ["--no-sandbox", "--no-remote"],
};

/** Read when a browser launches, since the profile folder depends on the active project */
const defaultLaunchOptions = (
  browserName: SupportedBrowser,
): BrowserLaunchOptions => ({
  port: 9222,
  profileDir: path.dirname(browserProfilePath(browserName)),
  headless: true,
});

const regexPrefix: Record<SupportedBrowser, RegExp> = {
  firefox: /WebDriver\sBiDi\slistening\son\s/,
  // chrome: /DevTools\slistening\son/,
};

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
    // case "chrome":
    //   baseLaunchFlags.push(`--user-data-dir=${profileDir}`);
    // break;
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

/**
 * Stops what a failed launch started. A browser left running holds the profile (the next launch
 * fails with "already open") and keeps the test process alive.
 */
export function abandonLaunch(
  browserProc: { kill(): boolean },
  biDiConnector: { kill(): void } | undefined,
): void {
  biDiConnector?.kill();
  browserProc.kill();
}

// On macOS a spawned browser is attributed to the terminal, which is denied access to
// ~/Library/Application Support/Firefox (profiles.ini). Point Firefox at a local app data dir instead.
const browserAppDataPath = (browserName: SupportedBrowser): string =>
  path.join(browsersDir(), "app-data", browserName);

const browserLaunchEnv = (browserName: SupportedBrowser) => {
  const appDataPath = browserAppDataPath(browserName);
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
    // The home page (about:home) is privileged: BiDi refuses commands such as setViewport on it
    user_pref("browser.startup.page", 0);
    user_pref("browser.startup.homepage", "about:blank");
    user_pref("browser.newtabpage.enabled", false);
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

/** Options of `browser.newContext()` */
export interface ContextOptions extends EmulationOptions {
  acceptInsecureCerts?: boolean;
  /** How this context's pages answer JavaScript dialogs; the session default is to leave them for the framework */
  unhandledPromptBehavior?: UserPromptHandler;
}

export class Browser {
  private browserProc: ChildProcessWithoutNullStreams;
  private biDiConnector: BiDiConnector;
  private userContexts = new Map<string, BrowserContext>();
  private host: ContextHost;
  /** The browser's own context, the one `Browser.launch`'s page lives in */
  public readonly defaultContext: BrowserContext;
  /** Where downloads are saved; undefined when the browser could not be told (it then uses its own folder) */
  public readonly downloadsDir: string | undefined;
  private exitedPromise: Promise<void> | undefined;

  constructor({
    browserProc,
    biDiConnector,
    downloadsDir,
  }: {
    browserProc: ChildProcessWithoutNullStreams;
    biDiConnector: BiDiConnector;
    downloadsDir?: string | undefined;
  }) {
    this.browserProc = browserProc;
    this.biDiConnector = biDiConnector;
    this.downloadsDir = downloadsDir;
    this.host = {
      connector: biDiConnector,
      newPage: (options) => this.newPage(options),
      forget: (context) => void this.userContexts.delete(context.id),
    };
    this.defaultContext = new BrowserContext(this.host, "default", true);
  }

  /** Resolves when the browser process has exited, whether `close()` or a person closed it */
  public get exited(): Promise<void> {
    this.exitedPromise ??= new Promise((resolve) => {
      if (this.browserProc.exitCode !== null || this.browserProc.signalCode)
        return resolve();
      this.browserProc.once("exit", () => resolve());
    });
    return this.exitedPromise;
  }

  static async launch(
    browserName: SupportedBrowser,
    launchOptions: Partial<BrowserLaunchOptions> = defaultLaunchOptions(
      browserName,
    ),
    /** Aborting kills the browser process and rejects the launch */
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    logger.verbose("Trying to launch browser %s", browserName);
    const browserLocation = findBrowser(browserName);
    logger.debug("Found browser install location at: %s", browserLocation);
    ensureBrowserProfile(browserName);

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
        logger.debug(`${browserName} stderr: ${data}`);

        const urlMatch = String(data).match(browserWsRegex[browserName]);
        logger.debug("Browser announced its endpoint", { urlMatch });
        if (!Array.isArray(urlMatch) || urlMatch.length === 0) {
          return;
        }
        // Killing the process mid-handshake rejects pending BiDi calls; surface that via reject
        // instead of an unhandled rejection from this async listener
        let biDiConnector: BiDiConnector | undefined;
        try {
          let url = urlMatch[0] + browserWsPath[browserName];
          logger.verbose("Websocket URL match: %s", url);
          biDiConnector = await BiDiConnector.connect(url, {
            commandTimeout: await readCommandTimeout(),
          });
          logger.verbose("Starting new session");
          const status = await biDiConnector.send("session.status", {});
          logger.verbose("Session status", status);
          await biDiConnector.send("session.new", {
            capabilities: SESSION_CAPABILITIES,
          });
          logger.verbose("Session started successfully");

          const downloadsDir = await prepareDownloadsDir(
            biDiConnector,
            path.resolve(
              projectDir(),
              (await readOptionalConfig("downloadsDir")) ?? "result/downloads",
            ),
          );
          const browser = new Browser({
            browserProc,
            biDiConnector,
            downloadsDir,
          });
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
            browser.defaultContext.register(page);
          } else {
            page = await browser.newPage({ type: "tab" });
          }
          await page.applyDefaultViewport();
          // Requests made before tracking starts are invisible to it, and a dialog nobody watches would hang the page
          await page.startNetworkTracking();
          await page.startDialogHandling();
          await page.startLogging();
          await page.startDownloadTracking();
          await page.startFileChooserTracking();
          browserProc.off("close", onUnexpectedClose);
          signal?.removeEventListener("abort", onAbort);
          resolve({
            browser,
            page,
          });
        } catch (err) {
          browserProc.off("close", onUnexpectedClose);
          signal?.removeEventListener("abort", onAbort);
          abandonLaunch(browserProc, biDiConnector);
          reject(err);
        }
      });
    });
  }

  /** Closes the browser via BiDi browser.close, then makes sure the process has exited */
  public async close() {
    if (this.browserProc.exitCode !== null || this.browserProc.signalCode) {
      this.biDiConnector.kill();
      removeIfEmpty(this.downloadsDir);
      return;
    }
    const exited = new Promise((resolve) =>
      this.browserProc.once("exit", resolve),
    );
    // User contexts outlive the browser in its profile unless they are removed
    await Promise.allSettled(
      [...this.userContexts.values()].map((context) => context.close()),
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
    // A folder nothing was downloaded into would only pile up
    removeIfEmpty(this.downloadsDir);
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
    logger.debug("Created browsing context", { createBrowserContext });
    const page = new Page(this.biDiConnector, createBrowserContext.context);
    this.contextFor(userContext).register(page);
    await page.applyDefaultViewport();
    await page.startNetworkTracking();
    await page.startDialogHandling();
    await page.startLogging();
    await page.startDownloadTracking();
    await page.startFileChooserTracking();
    return page;
  }

  /**
   * Creates an isolated context: its own cookies, storage and cache. `browser.close()` removes the contexts
   * that are still open, as Firefox would otherwise keep them in its profile.
   * @example
   *  const alice = await browser.newContext();
   *  const page = await alice.newPage();
   */
  public async newContext(
    options: ContextOptions = {},
  ): Promise<BrowserContext> {
    const { acceptInsecureCerts, unhandledPromptBehavior, ...emulation } =
      options;
    // A wrong value must not leave a context behind, so it is refused before one is created
    validateEmulation(emulation);
    const { userContext } = await this.biDiConnector.send(
      "browser.createUserContext",
      {
        ...(acceptInsecureCerts !== undefined && { acceptInsecureCerts }),
        ...(unhandledPromptBehavior && { unhandledPromptBehavior }),
      },
    );
    const context = new BrowserContext(this.host, userContext, false);
    this.userContexts.set(userContext, context);
    if (Object.keys(emulation).length > 0) {
      try {
        await context.emulate(emulation);
      } catch (err) {
        // Firefox keeps a context in its profile until it is removed
        await context.close().catch((closeErr) =>
          logger.debug("Could not remove a context whose emulation failed", {
            closeErr,
          }),
        );
        throw err;
      }
    }
    return context;
  }

  /** The default context, then the contexts this browser created that are still open */
  public contexts(): BrowserContext[] {
    return [this.defaultContext, ...this.userContexts.values()];
  }

  private contextFor(userContext: string | undefined): BrowserContext {
    if (userContext === undefined || userContext === "default")
      return this.defaultContext;
    return this.userContexts.get(userContext) ?? this.adopt(userContext);
  }

  /** A user context this browser did not create (Firefox keeps them in its profile): usable, never closed by `close()` */
  private adopt(userContext: string): BrowserContext {
    const context = new BrowserContext(this.host, userContext, false);
    this.userContexts.set(userContext, context);
    return context;
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

/** A config value, or undefined when it is not set or the config cannot be read */
async function readOptionalConfig<K extends "downloadsDir">(key: K) {
  try {
    return await readConfig(key);
  } catch (err) {
    logger.debug("Could not read %s from config, using the default", key, {
      err,
    });
    return undefined;
  }
}

/** The configured BiDi command timeout; a missing or unreadable config falls back to the connector default */
async function readCommandTimeout() {
  try {
    return (await readConfig("bidi"))?.commandTimeout;
  } catch (err) {
    logger.debug("Could not read bidi config, using defaults", { err });
    return undefined;
  }
}

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
