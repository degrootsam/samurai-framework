import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import type { SupportedBrowser } from "../types/browser.js";
import { projectBrowser } from "../browsers/resolve.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import Page from "./page.js";
import { launchChrome, type BrowserProcess } from "./chrome-launch.js";
import { BrowserContext, type ContextHost } from "./browser-context.js";
import type { UserPromptHandler } from "../types/bidi-modules/session.js";
import { validateEmulation, type EmulationOptions } from "./emulation.js";
import { prepareDownloadsDir, removeIfEmpty } from "./downloads-dir.js";
import { ChromeDownloadFolders } from "./download-folders.js";
import { launchFirefox } from "./launch-firefox.js";
import {
  defaultLaunchOptions,
  ensureBrowserProfile,
  type BrowserLaunchOptions,
} from "./launch-flags.js";
import { abandonLaunch } from "./session.js";
import type { BiDiCommands } from "../types/bidi.js";
import logger from "../logger/index.js";
import { projectDir, readConfig } from "../config/config.js";
import type {
  CookieFilter,
  PartialCookie,
  PartitionDescriptor,
} from "../types/bidi-modules/storage.js";

export type { BrowserLaunchOptions } from "./launch-flags.js";

/** Time (ms) to wait for Firefox to answer browser.close before killing the process */
const BROWSER_CLOSE_GRACE = 2000;

/** Options of `browser.newContext()` */
export interface ContextOptions extends EmulationOptions {
  acceptInsecureCerts?: boolean;
  /** How this context's pages answer JavaScript dialogs; the session default is to leave them for the framework */
  unhandledPromptBehavior?: UserPromptHandler;
}

export class Browser {
  private browserProc: BrowserProcess;
  private biDiConnector: BiDiConnector;
  private userContexts = new Map<string, BrowserContext>();
  private host: ContextHost;
  /** The browser's own context, the one `Browser.launch`'s page lives in */
  public readonly defaultContext: BrowserContext;
  /** Where downloads are saved; undefined when the browser could not be told (it then uses its own folder) */
  public readonly downloadsDir: string | undefined;
  private exitedPromise: Promise<void> | undefined;
  private downloadFolders: ChromeDownloadFolders | undefined;

  constructor({
    browserProc,
    biDiConnector,
    downloadsDir,
    downloadFolders,
  }: {
    browserProc: BrowserProcess;
    biDiConnector: BiDiConnector;
    downloadsDir?: string | undefined;
    downloadFolders?: ChromeDownloadFolders | undefined;
  }) {
    this.downloadFolders = downloadFolders;
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
    const resolved = await projectBrowser(browserName);
    logger.debug(
      "Found browser install location at: %s",
      resolved.executablePath,
    );
    ensureBrowserProfile(
      browserName,
      launchOptions.profileDir &&
        path.join(launchOptions.profileDir, "user.js"),
    );
    const commandTimeout = await readCommandTimeout();

    // Both launchers hand back an open BiDi session: Firefox after session.new, Chrome with the one
    // its chromedriver created
    const { proc, connector } =
      browserName === "chrome"
        ? await launchChrome({
            executablePath: resolved.executablePath,
            driverPath: resolved.driverPath!,
            profileDir:
              launchOptions.profileDir ??
              defaultLaunchOptions("chrome").profileDir,
            headless:
              launchOptions.headless ?? defaultLaunchOptions("chrome").headless,
            commandTimeout,
            signal,
          })
        : await launchFirefox({
            executablePath: resolved.executablePath,
            label: resolved.label,
            launchOptions,
            commandTimeout,
            signal,
          });
    try {
      return await Browser.attach(proc, connector, browserName);
    } catch (err) {
      abandonLaunch(proc, connector);
      throw err;
    }
  }

  /** Sets up a browser whose BiDi session is open: downloads folder, the first page and what it tracks */
  private static async attach(
    browserProc: BrowserProcess,
    biDiConnector: BiDiConnector,
    browserName: SupportedBrowser,
  ): Promise<{ browser: Browser; page: Page }> {
    biDiConnector.browserName = browserName;
    const downloadsDir = await prepareDownloadsDir(
      biDiConnector,
      path.resolve(
        projectDir(),
        (await readDownloadsDir()) ?? "result/downloads",
      ),
    );
    // Chrome replaces a file that has the name of a download; this keeps every download
    const downloadFolders =
      browserName === "chrome" && downloadsDir
        ? new ChromeDownloadFolders(biDiConnector, downloadsDir)
        : undefined;
    await downloadFolders?.start();
    const browser = new Browser({
      browserProc,
      biDiConnector,
      downloadsDir,
      downloadFolders,
    });
    logger.verbose("Requesting current browser tree");
    const browserTree = await biDiConnector.send("browsingContext.getTree", {});
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
    await page.startTracking();
    return { browser, page };
  }

  /** Closes the browser via BiDi browser.close, then makes sure the process has exited */
  public async close() {
    await this.downloadFolders?.dispose();
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
    await page.startTracking();
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

/** The configured downloads folder; a missing or unreadable config falls back to the default */
async function readDownloadsDir() {
  try {
    return await readConfig("downloadsDir");
  } catch (err) {
    logger.debug("Could not read downloadsDir from config, using the default", {
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
