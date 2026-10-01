import Locator, { type TextOptions } from "../locator/locator.js";
import { cssSelector, labelSelector, roleSelector, testIdSelector, textSelector } from "../locator/selector.js";
import EventEmitter from "node:events";
import { readConfig } from "../config/config.js";
import { peekRunSettings } from "../config/run-settings.js";
import logger from "../logger/index.js";
import {
  NetworkTracker,
  type NetworkEventName,
} from "../network/network-tracker.js";
import type { NetworkRequest, NetworkResponse, FailedRequest } from "../network/network-tracker.js";
import { Recorder, type RecorderOptions } from "../recorder/recorder.js";
import { ContextTree } from "./context-tree.js";
import { Dialog } from "./dialog.js";
import type { BrowserContext } from "./browser-context.js";
import { printPdf, type PdfOptions } from "./pdf.js";
import { applyEmulation, type EmulationOptions } from "./emulation.js";
import { Download, DownloadTracker } from "./download.js";
import { FileChooser, FileChooserTracker } from "./file-chooser.js";
import { DownloadWaitTimeoutError, FileChooserTimeoutError } from "./page-wait.js";
import { takeScreenshot, type ScreenshotOptions } from "./screenshot.js";
import { PageLogs, type ConsoleMessage, type LogRecord, type PageError } from "./page-logs.js";
import { Router, type RouteHandler } from "../network/router.js";
import { DataCollector, ResponseBodyUnavailableError } from "../network/data-collector.js";
import { Response } from "../network/response.js";
import {
  RequestTimeoutError,
  ResponseTimeoutError,
  toPredicate,
  type NetworkMatch,
} from "../network/network-wait.js";
import { UnsupportedOperationError } from "../locator/selector-errors.js";
import type { UrlPattern } from "../network/url-match.js";
import type {
  UserPromptClosedParameters,
  UserPromptOpenedParameters,
} from "../types/bidi-modules/browsing-context.js";
import { toFunctionDeclaration } from "../script/call-function.js";
import { HelperRealm } from "../script/helpers.js";
import { addPreload, type PreloadHandle } from "../script/preload.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BiDiCommands } from "../types/bidi.js";
import type { SamuraiTestConfig } from "../types/config.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { Subscription } from "../transport/subscriptions.js";
import { WaitTimeoutError } from "../wait/wait-until.js";
import { LoadStateTimeoutError, NavigationError } from "./navigation-error.js";
import { callFunction } from "../script/call-function.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";

/** Time (ms) a navigation or a wait for a load state may take */
const DEFAULT_NAVIGATION_TIMEOUT = 30000;
/** Time (ms) without requests in flight that counts as idle */
const DEFAULT_IDLE_TIME = 500;

/** Options that otherwise come from `samurai.config.ts` */
export type PageSettings = Pick<SamuraiTestConfig, "network" | "navigation" | "use">;

/** The size a page gets unless config `use.viewport` says otherwise */
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

export type ReadinessState = NonNullable<
  BiDiCommands["browsingContext.navigate"]["params"]["wait"]
>;
export type LoadState = "load" | "domcontentloaded" | "networkidle";

export interface NavigateOptions {
  /** When navigateTo resolves. @default config `navigation.waitUntil`, then "complete" */
  wait?: ReadinessState;
  /** Time (ms) the navigation may take. @default config `navigation.timeout`, then 30000 */
  timeout?: number;
  /** Scheme added to a URL without one. @default "https" */
  protocol?: "http" | "https";
}

interface NetworkEvents {
  request: [NetworkRequest];
  response: [Response];
  requestfailed: [FailedRequest];
}

/** Everything `page.on` can listen for */
interface PageEvents extends NetworkEvents {
  download: [Download];
  filechooser: [FileChooser];
  dialog: [Dialog];
  console: [ConsoleMessage];
  pageerror: [PageError];
}
export type PageEventName = keyof PageEvents;

/** Events a connection's browser rejected as unknown, so nothing asks for them again */
const unsupportedEventsByConnector = new WeakMap<BiDiConnector, Set<string>>();

function unsupportedEvents(connector: BiDiConnector): Set<string> {
  let events = unsupportedEventsByConnector.get(connector);
  if (!events) unsupportedEventsByConnector.set(connector, (events = new Set()));
  return events;
}

class NetworkTrackingDisabledError extends Error {
  constructor() {
    super("network tracking is disabled");
    this.name = "NetworkTrackingDisabledError";
  }
}

async function readSection<K extends keyof PageSettings>(
  key: K,
): Promise<NonNullable<PageSettings[K]>> {
  try {
    return ((await readConfig(key)) ?? {}) as NonNullable<PageSettings[K]>;
  } catch (err) {
    logger.debug("Could not read %s config, using defaults", key, { err });
    return {} as NonNullable<PageSettings[K]>;
  }
}

export default class Page {
  private biDiConnector: BiDiConnector;
  private id: BrowsingContext;
  private contextTree: Promise<ContextTree> | undefined;
  private helperRealm: HelperRealm;
  private initScripts = new Set<PreloadHandle>();
  private settings: PageSettings | undefined;
  private networkTracker: Promise<NetworkTracker> | undefined;
  private pageEvents = new EventEmitter();
  /** The navigation started by the last navigateTo; failures of it fail a wait */
  private lastNavigation: string | undefined;
  /** Base for relative page.goto URLs; falls back to the active run's baseURL */
  private baseURL: string | undefined;
  /** How far navigations that did not wait for the load got, by navigation id (the latest few) */
  private navigationProgress = new Map<string, { domContentLoaded: boolean; load: boolean }>();
  private documentEvents: Promise<Subscription> | undefined;
  private dialogHandling: Promise<Subscription> | undefined;
  private pageLogs: Promise<PageLogs> | undefined;
  private loadedLogs: PageLogs | undefined;
  private errorsAllowed = false;
  private isClosed = false;
  private browserContext: BrowserContext | undefined;
  private downloadTracker: Promise<DownloadTracker> | undefined;
  private fileChooserTracker: Promise<FileChooserTracker> | undefined;
  private collectorPromise: Promise<DataCollector> | undefined;
  private responses = new WeakMap<NetworkResponse, Response>();
  private routerPromise: Promise<Router> | undefined;
  private loadedRouter: Router | undefined;
  /** The context tree once loaded, for handlers that cannot wait for it */
  private loadedTree: ContextTree | undefined;
  private openDialogs = new Map<string, Dialog>();

  /** `settings` override what `samurai.config.ts` says; without them the config is read when needed */
  constructor(biDiConnector: BiDiConnector, contextId: string, settings?: PageSettings) {
    this.biDiConnector = biDiConnector;
    this.id = contextId;
    this.settings = settings;
    this.helperRealm = new HelperRealm(biDiConnector, contextId);
  }

  /** The BiDi browsing context id of this page's top-level context */
  public get contextId(): BrowsingContext {
    return this.id;
  }

  /** The context tree, created on first use and shared by everything that needs to attribute frame events to this page */
  public tree(): Promise<ContextTree> {
    this.contextTree ??= ContextTree.create(this.biDiConnector).then(
      (tree) => (this.loadedTree = tree),
      (err) => {
        this.contextTree = undefined;
        throw err;
      },
    );
    return this.contextTree;
  }
  /** Locates an element on the page and returns an interactable object */
  public locator(xpath: string) {
    this.assertOpen();
    return new Locator(xpath, this.biDiConnector, this.id, this.helperRealm);
  }

  /** Locates elements with a CSS selector */
  public getByCss(css: string) {
    this.assertOpen();
    return new Locator([cssSelector(css)], this.biDiConnector, this.id, this.helperRealm);
  }

  /** Locates elements by their text: an exact match unless `match: "partial"` */
  public getByText(text: string, options?: TextOptions) {
    this.assertOpen();
    return new Locator([textSelector(text, options)], this.biDiConnector, this.id, this.helperRealm);
  }

  /** Locates form controls by their label text: an exact match unless `match: "partial"` */
  public getByLabel(text: string, options?: TextOptions) {
    this.assertOpen();
    return new Locator([labelSelector(text, options)], this.biDiConnector, this.id, this.helperRealm);
  }

  /** Locates elements by their `data-testid` attribute */
  public getByTestId(testId: string) {
    this.assertOpen();
    return new Locator([testIdSelector(testId)], this.biDiConnector, this.id, this.helperRealm);
  }

  /** Locates elements by ARIA role and, optionally, accessible name */
  public getByRole(role: string, options?: { name?: string }) {
    this.assertOpen();
    return new Locator([roleSelector(role, options)], this.biDiConnector, this.id, this.helperRealm);
  }

  /**
   * Runs `script` before any page script in every document this page loads from now on, and once in
   * the document that is loaded now. It runs in the page's own realm, so the page sees what it sets.
   * A function receives `arg` (which must be JSON-serializable) as its only argument;
   * a string is script source (statements) and takes no argument.
   * @example
   *  await page.addInitScript(() => { window.__testMode = true; });
   *  await page.addInitScript((flags) => { window.flags = flags; }, { beta: true });
   */
  public async addInitScript(
    script: string | ((arg?: any) => void),
    arg?: unknown,
  ): Promise<PreloadHandle> {
    this.assertOpen();
    const source = initScriptSource(script, arg);
    const handle = await addPreload(this.biDiConnector, {
      source,
      contexts: [this.id],
      onRunError: "log",
    });
    const tracked: PreloadHandle = {
      id: handle.id,
      dispose: async () => {
        this.initScripts.delete(tracked);
        await handle.dispose();
      },
    };
    this.initScripts.add(tracked);
    return tracked;
  }

  /**
   * Starts recording what a person does in the page as steps (see `Recorder`). The page must be driven by
   * a person; stop with `recorder.stop()`.
   */
  public record(options: RecorderOptions): Promise<Recorder> {
    this.assertOpen();
    return Recorder.start({ page: this, connector: this.biDiConnector, context: this.id }, options);
  }

  /** Removes everything the page registered in the browser: init scripts, framework helpers and event subscriptions */
  public async dispose(): Promise<void> {
    const scripts = [...this.initScripts];
    const tracker = this.networkTracker;
    this.networkTracker = undefined;
    const results = await Promise.allSettled([
      ...scripts.map((handle) => handle.dispose()),
      this.helperRealm.dispose(),
      // The tracker goes before the tree it reads
      tracker?.then((resolved) => resolved.dispose()).catch(() => undefined),
    ]);
    const tree = this.contextTree;
    this.contextTree = undefined;
    const documentEvents = this.documentEvents;
    this.documentEvents = undefined;
    const dialogHandling = this.dialogHandling;
    this.dialogHandling = undefined;
    const pageLogs = this.pageLogs;
    this.pageLogs = undefined;
    this.loadedLogs = undefined;
    const downloads = this.downloadTracker;
    this.downloadTracker = undefined;
    const fileChoosers = this.fileChooserTracker;
    this.fileChooserTracker = undefined;
    const collector = this.collectorPromise;
    this.collectorPromise = undefined;
    const router = this.routerPromise;
    this.routerPromise = undefined;
    this.loadedRouter = undefined;
    this.biDiConnector.offEvent("browsingContext.userPromptOpened", this.onPromptOpened);
    this.biDiConnector.offEvent("browsingContext.userPromptClosed", this.onPromptClosed);
    this.openDialogs.clear();
    this.biDiConnector.offEvent("browsingContext.domContentLoaded", this.onDomContentLoaded);
    this.biDiConnector.offEvent("browsingContext.load", this.onLoad);
    results.push(
      ...(await Promise.allSettled([
        tree?.then((resolved) => resolved.dispose()),
        documentEvents?.then((subscription) => subscription.unsubscribe()),
        dialogHandling?.then((subscription) => subscription.unsubscribe()),
        pageLogs?.then((logs) => logs.dispose()),
        router?.then((resolved) => resolved.dispose()),
        collector?.then((resolved) => resolved.dispose()),
        downloads?.then((resolved) => resolved.dispose()),
        fileChoosers?.then((resolved) => resolved.dispose()),
      ])),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
  }

  /** Sets the base that relative `goto` URLs resolve against; `undefined` falls back to the run's baseURL */
  public setBaseURL(url: string | undefined): void {
    this.baseURL = url;
  }

  /**
   * Navigates like `navigateTo`, but a URL starting with "/", "./" or "../" resolves against the base URL
   * (`setBaseURL`, else the environment's `baseURL`).
   * @example
   *  await page.goto("/products");
   *  await page.goto("https://example.com", { wait: "interactive" });
   */
  public async goto(
    url: string,
    options?: NavigateOptions,
  ): Promise<{ navigation: string | null; url: string }> {
    if (!/^\.{0,2}\//.test(url)) return this.navigateTo(url, options);
    const base = this.baseURL ?? peekRunSettings()?.baseURL;
    if (!base) {
      throw new Error(`page.goto("${url}") needs a baseURL; set one in samurai.config.ts or the environment`);
    }
    return this.navigateTo(new URL(url, base).href, options);
  }

  /**
   * Navigates to `url` and resolves when the page reached `wait` (default "complete", the load event).
   * A URL without a scheme gets `https://`. Throws NavigationError when the navigation fails or takes too long.
   * The positional form `navigateTo(url, wait, protocol)` still works.
   * @example
   *  await page.navigateTo("example.com");
   *  await page.navigateTo("localhost:3000", { wait: "interactive", protocol: "http" });
   */
  public async navigateTo(
    url: string,
    options?: NavigateOptions | ReadinessState,
    protocol?: "http" | "https",
  ): Promise<{ navigation: string | null; url: string }> {
    const given: NavigateOptions = typeof options === "string" ? { wait: options } : (options ?? {});
    const settings = await this.navigationSettings();
    const wait = given.wait ?? settings.waitUntil ?? "complete";
    const timeout = given.timeout ?? settings.timeout ?? DEFAULT_NAVIGATION_TIMEOUT;
    // A scheme is letters followed by ":" not directly followed by a digit, so "localhost:3000" is a host
    const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(url);
    const parsedURL = hasScheme ? url : `${given.protocol ?? protocol ?? "https"}://${url}`;
    this.assertOpen();
    return this.navigation("navigateTo", async () => parsedURL, wait, timeout, async (sendOptions) => {
      const result = await this.biDiConnector.send(
        "browsingContext.navigate",
        { context: this.id, url: parsedURL, wait },
        sendOptions,
      );
      return { navigation: result.navigation ?? null, url: result.url ?? parsedURL };
    });
  }

  /**
   * Runs a navigation command and settles what waiting for it means: failures become NavigationErrors, and a
   * navigation that did not wait for the load is watched so `waitForLoadState` can tell it from the old page.
   */
  private async navigation(
    operation: string,
    describe: () => Promise<string>,
    wait: ReadinessState,
    timeout: number,
    send: (options: { timeout: number }) => Promise<{ navigation: string | null; url: string }>,
  ): Promise<{ navigation: string | null; url: string }> {
    // A navigation that does not wait for the load needs watching, or waitForLoadState cannot tell it from the old page
    if (wait !== "complete") await this.watchDocumentEvents();
    try {
      const result = await send({ timeout });
      this.lastNavigation = result.navigation ?? undefined;
      if (result.navigation && wait !== "complete") {
        // Tracked from now on: the document still showing is the old one until this navigation commits
        const progress = this.progressOf(result.navigation);
        if (wait === "interactive") progress.domContentLoaded = true;
      }
      return result;
    } catch (err) {
      if (err instanceof BiDiError) {
        const reason = err.code === "timeout" ? `timeout after ${timeout}ms` : err.message;
        throw new NavigationError(await describe(), reason, err.code, operation);
      }
      throw err;
    }
  }

  /**
   * Reloads the page and resolves when it reached `wait` (default like `navigateTo`). Firefox does not support
   * `ignoreCache`; asking for it throws UnsupportedOperationError.
   */
  public async reload(
    options: { wait?: ReadinessState; timeout?: number; ignoreCache?: boolean } = {},
  ): Promise<{ navigation: string | null; url: string }> {
    this.assertOpen();
    const settings = await this.navigationSettings();
    const wait = options.wait ?? settings.waitUntil ?? "complete";
    const timeout = options.timeout ?? settings.timeout ?? DEFAULT_NAVIGATION_TIMEOUT;
    return this.navigation("reload", () => this.url().catch(() => "the page"), wait, timeout, async (sendOptions) => {
      try {
        const result = await this.biDiConnector.send(
          "browsingContext.reload",
          { context: this.id, wait, ...(options.ignoreCache && { ignoreCache: true }) },
          sendOptions,
        );
        return { navigation: result.navigation ?? null, url: result.url };
      } catch (err) {
        if (options.ignoreCache && err instanceof BiDiError && err.code === "unsupported operation") {
          throw new UnsupportedOperationError("reload({ ignoreCache }) is not supported by the browser");
        }
        throw err;
      }
    });
  }

  /** Goes back one entry in the history. False when there is none to go back to */
  public goBack(): Promise<boolean> {
    return this.traverse(-1);
  }

  /** Goes forward one entry in the history. False when there is none */
  public goForward(): Promise<boolean> {
    return this.traverse(1);
  }

  private async traverse(delta: -1 | 1): Promise<boolean> {
    this.assertOpen();
    try {
      await this.biDiConnector.send("browsingContext.traverseHistory", { context: this.id, delta });
      return true;
    } catch (err) {
      if (err instanceof BiDiError && err.code === "no such history entry") return false;
      throw err;
    }
  }

  /** The URL of the page now */
  public async url(): Promise<string> {
    this.assertOpen();
    return callFunction<string>(this.biDiConnector, this.id, "() => location.href", [], { awaitPromise: false });
  }

  /** The title of the document now */
  public async title(): Promise<string> {
    this.assertOpen();
    return callFunction<string>(this.biDiConnector, this.id, "() => document.title", [], { awaitPromise: false });
  }

  /**
   * Sets the size of the viewport (and, optionally, the device pixel ratio); `null` puts the browser's own size back.
   * @example
   *  await page.setViewport({ width: 390, height: 844, devicePixelRatio: 3 });
   */
  public async setViewport(
    viewport: { width: number; height: number; devicePixelRatio?: number } | null,
  ): Promise<void> {
    this.assertOpen();
    if (viewport === null) {
      await this.biDiConnector.send("browsingContext.setViewport", {
        context: this.id,
        viewport: null,
        devicePixelRatio: null,
      });
      return;
    }
    const { width, height, devicePixelRatio } = viewport;
    for (const [name, value] of [["width", width], ["height", height]] as const) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError(`setViewport(): ${name} must be a positive integer, got ${value}`);
      }
    }
    if (devicePixelRatio !== undefined && !(devicePixelRatio > 0 && Number.isFinite(devicePixelRatio))) {
      throw new RangeError(`setViewport(): devicePixelRatio must be a positive number, got ${devicePixelRatio}`);
    }
    await this.biDiConnector.send("browsingContext.setViewport", {
      context: this.id,
      viewport: { width, height },
      ...(devicePixelRatio !== undefined && { devicePixelRatio }),
    });
  }

  /** Gives the page the size from config `use.viewport` (1280x720 by default); the browser does this when it opens a page */
  public async applyDefaultViewport(): Promise<void> {
    const { viewport } = this.settings?.use ?? (await readSection("use"));
    if (viewport === null) return;
    await this.setViewport(viewport ?? DEFAULT_VIEWPORT);
  }

  /**
   * Takes a screenshot and returns the image (also written to `options.path`).
   * @example
   *  await page.screenshot({ path: "out/home.png", fullPage: true });
   */
  public async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    this.assertOpen();
    return takeScreenshot(this.biDiConnector, this.id, options);
  }

  /** Renders the page as a PDF and returns it (also written to `options.path`) */
  public async pdf(options: PdfOptions = {}): Promise<Buffer> {
    this.assertOpen();
    return printPdf(this.biDiConnector, this.id, options);
  }

  /** The browser context (cookies, storage) this page belongs to */
  public context(): BrowserContext {
    if (!this.browserContext) throw new Error("this page has no browser context: open it with browser.newPage() or context.newPage()");
    return this.browserContext;
  }

  /** @internal Called when the page is opened in a context */
  public setContext(context: BrowserContext): void {
    this.browserContext = context;
  }

  /** @internal Marks the page closed after its tab is gone (its context was removed) and releases what it registered */
  public async detach(): Promise<void> {
    this.isClosed = true;
    await this.dispose().catch((err) => logger.debug("Releasing a detached page failed", { err }));
  }

  /**
   * Pretends things about this page only: locale, timezone, user agent, geolocation, offline, orientation, screen
   * size. It wins over what the page's context says; `null` puts the real (or the context's) value back.
   * @example
   *  await page.emulate({ locale: "nl-NL", offline: true });
   */
  public async emulate(options: EmulationOptions): Promise<void> {
    this.assertOpen();
    await applyEmulation(this.biDiConnector, { contexts: [this.id] }, options);
  }

  /**
   * Grants a browser permission ("geolocation", "notifications", "camera", …) to the origin this page is on,
   * or to `options.origin`. Geolocation emulation only answers once this is granted.
   */
  public async grantPermission(name: string, options: { origin?: string } = {}): Promise<void> {
    this.assertOpen();
    const origin = options.origin ?? new URL(await this.url()).origin;
    // about:blank and data: pages have no origin to grant to
    if (origin === "null") throw new Error("grantPermission() needs a page on a web origin, or an explicit origin option");
    const context = this.browserContext;
    await this.biDiConnector.send("permissions.setPermission", {
      descriptor: { name },
      state: "granted",
      origin,
      ...(context && !context.isDefault && { userContext: context.id }),
    });
  }

  /** True once `close()` has run */
  public get closed(): boolean {
    return this.isClosed;
  }

  private assertOpen() {
    if (this.isClosed) throw new Error("page closed");
  }

  /**
   * Closes the tab and releases everything the page registered. Later calls on the page throw "page closed".
   * With `runBeforeUnload` the page's `beforeunload` handlers run first. Closing the browser's last tab may end the browser.
   */
  public async close(options: { runBeforeUnload?: boolean } = {}): Promise<void> {
    if (this.isClosed) return;
    try {
      await this.biDiConnector.send("browsingContext.close", {
        context: this.id,
        ...(options.runBeforeUnload && { promptUnload: true }),
      });
    } catch (err) {
      // Already gone (closed by the page, the browser or another call): the goal is met
      if (!(err instanceof BiDiError && err.code === "no such frame")) throw err;
    }
    this.isClosed = true;
    await this.dispose().catch((err) => logger.debug("Releasing a closed page failed", { err }));
  }

  /**
   * Waits until the page's document reached `state` (default "load"): "domcontentloaded" and "load" follow the
   * document, "networkidle" is "load" plus a quiet network (see `waitForNetworkIdle`). Resolves at once when it
   * is already there. Call it once the navigation has started; a document that is still the old one counts.
   * @example
   *  await page.locator("a[@id='next']").click();
   *  await page.waitForLoadState("domcontentloaded");
   */
  public async waitForLoadState(
    state: LoadState = "load",
    options: { timeout?: number } = {},
  ): Promise<void> {
    this.assertOpen();
    const timeout =
      options.timeout ?? (await this.navigationSettings()).timeout ?? DEFAULT_NAVIGATION_TIMEOUT;
    try {
      await this.waitForDocumentState(state === "domcontentloaded" ? "domcontentloaded" : "load", timeout);
    } catch (err) {
      if (err instanceof WaitTimeoutError) throw new LoadStateTimeoutError(state, timeout);
      throw err;
    }
    if (state === "networkidle") {
      const tracker = await this.network();
      const idleTime = (await this.networkSettings()).idleTime ?? DEFAULT_IDLE_TIME;
      await tracker.waitForIdle({ idleTime, timeout });
    }
  }

  private progressOf(navigation: string) {
    let progress = this.navigationProgress.get(navigation);
    if (!progress) {
      progress = { domContentLoaded: false, load: false };
      this.navigationProgress.set(navigation, progress);
      // Only the latest few navigations matter
      if (this.navigationProgress.size > 20) {
        this.navigationProgress.delete(this.navigationProgress.keys().next().value as string);
      }
    }
    return progress;
  }

  private onDocumentEvent = (kind: "domContentLoaded" | "load") => (info: { context: string; navigation: string | null }) => {
    if (info.context !== this.id || info.navigation === null) return;
    const progress = this.progressOf(info.navigation);
    progress.domContentLoaded = true;
    if (kind === "load") progress.load = true;
  };
  private onDomContentLoaded = this.onDocumentEvent("domContentLoaded");
  private onLoad = this.onDocumentEvent("load");

  /** Starts recording which navigations reached DOMContentLoaded and load; kept until dispose */
  private watchDocumentEvents(): Promise<Subscription> {
    this.documentEvents ??= (async () => {
      this.biDiConnector.onEvent("browsingContext.domContentLoaded", this.onDomContentLoaded);
      this.biDiConnector.onEvent("browsingContext.load", this.onLoad);
      try {
        return await this.biDiConnector.subscribe([
          "browsingContext.domContentLoaded",
          "browsingContext.load",
        ]);
      } catch (err) {
        this.biDiConnector.offEvent("browsingContext.domContentLoaded", this.onDomContentLoaded);
        this.biDiConnector.offEvent("browsingContext.load", this.onLoad);
        this.documentEvents = undefined;
        throw err;
      }
    })();
    return this.documentEvents;
  }

  private canBeAborted(): boolean {
    return !unsupportedEvents(this.biDiConnector).has("browsingContext.navigationAborted");
  }

  /** Subscribes to what a wait listens for; a browser that lacks the navigationAborted event (Firefox) is asked only once */
  private async subscribeToDocumentEvents(reachedEvent: "browsingContext.load" | "browsingContext.domContentLoaded") {
    const required = [reachedEvent, "browsingContext.navigationFailed"] as const;
    if (!this.canBeAborted()) return this.biDiConnector.subscribe([...required]);
    try {
      return await this.biDiConnector.subscribe([...required, "browsingContext.navigationAborted"]);
    } catch (err) {
      if (!(err instanceof BiDiError) || err.code !== "invalid argument") throw err;
      unsupportedEvents(this.biDiConnector).add("browsingContext.navigationAborted");
      return this.biDiConnector.subscribe([...required]);
    }
  }

  private async waitForDocumentState(target: "load" | "domcontentloaded", timeout: number) {
    const connector = this.biDiConnector;
    const reachedEvent = target === "load" ? "browsingContext.load" : "browsingContext.domContentLoaded";
    const subscription = await this.subscribeToDocumentEvents(reachedEvent);
    const abort = new AbortController();
    const last = this.lastNavigation;
    const listen = { timeout, signal: abort.signal };
    const failure = (info: { url: string }, what: string) => {
      throw new NavigationError(info.url, what, undefined, "waitForLoadState");
    };
    try {
      // Registered before the state is read, so an event in between is not lost
      const events = Promise.race([
        connector.waitForEvent(reachedEvent, (p) => p.context === this.id, listen),
        connector
          .waitForEvent(
            "browsingContext.navigationFailed",
            (p) => p.context === this.id && (last === undefined || p.navigation === last),
            listen,
          )
          .then((p) => failure(p, "navigation failed")),
        ...(this.canBeAborted()
          ? [
              connector
                .waitForEvent(
                  "browsingContext.navigationAborted",
                  (p) => p.context === this.id && last !== undefined && p.navigation === last,
                  listen,
                )
                .then((p) => failure(p, "navigation aborted")),
            ]
          : []),
      ]);
      events.catch(() => {}); // settled below, or aborted in finally
      const known = last === undefined ? undefined : this.navigationProgress.get(last);
      // A navigation we started and saw fall short of the state beats the document that is showing
      let reached: boolean;
      if (known && !(target === "load" ? known.load : known.domContentLoaded)) {
        reached = false;
      } else {
        const readyState = await callFunction<string>(connector, this.id, "() => document.readyState", [], {
          awaitPromise: false,
        });
        reached =
          target === "load" ? readyState === "complete" : readyState === "interactive" || readyState === "complete";
      }
      if (!reached) await events;
    } finally {
      abort.abort();
      await subscription.unsubscribe();
    }
  }

  private networkSettings() {
    return this.settings?.network ? Promise.resolve(this.settings.network) : readSection("network");
  }

  private navigationSettings() {
    return this.settings?.navigation
      ? Promise.resolve(this.settings.navigation)
      : readSection("navigation");
  }

  /** The network tracker, created on first use. Rejects with NetworkTrackingDisabledError when config turned tracking off */
  private network(): Promise<NetworkTracker> {
    this.networkTracker ??= (async () => {
      const settings = await this.networkSettings();
      if (settings.track === false) throw new NetworkTrackingDisabledError();
      const tracker = await NetworkTracker.start(this.biDiConnector, await this.tree(), this.id);
      tracker.on("request", (request) => this.pageEvents.emit("request", request));
      tracker.on("response", (response) => this.pageEvents.emit("response", this.responseFor(response)));
      tracker.on("requestfailed", (failed) => this.pageEvents.emit("requestfailed", failed));
      if (settings.collectBodies) await this.startBodyCollection();
      return tracker;
    })().catch((err) => {
      if (!(err instanceof NetworkTrackingDisabledError)) this.networkTracker = undefined;
      throw err;
    });
    return this.networkTracker;
  }

  /**
   * Starts following this page's requests now. Tracking only sees requests made after it started, so the
   * browser calls this when it opens a page; without it, tracking starts on first use. Does nothing when
   * config `network.track` is false.
   */
  public async startNetworkTracking(): Promise<void> {
    try {
      await this.network();
    } catch (err) {
      if (!(err instanceof NetworkTrackingDisabledError)) throw err;
    }
  }

  /**
   * Waits until no request has been in flight for `idleTime` ms (default config `network.idleTime`, then 500).
   * Long-lived requests (server-sent events, long polling) keep the page busy until `timeout`.
   */
  public async waitForNetworkIdle(options: { idleTime?: number; timeout?: number } = {}): Promise<void> {
    const tracker = await this.network();
    const idleTime = options.idleTime ?? (await this.networkSettings()).idleTime ?? DEFAULT_IDLE_TIME;
    const timeout =
      options.timeout ?? (await this.navigationSettings()).timeout ?? DEFAULT_NAVIGATION_TIMEOUT;
    await tracker.waitForIdle({ idleTime, timeout });
  }

  /**
   * Listens for page events: `request`, `response`, `requestfailed` (network), `dialog` (a JavaScript dialog or
   * `beforeunload` prompt opened; answer it with `dialog.accept()` / `dialog.dismiss()`), `console` (a `console.*` call)
   * and `pageerror` (an uncaught exception). Starts what the event needs.
   * A dialog nobody answers is dismissed automatically (a `beforeunload` prompt is accepted), so it cannot hang a test.
   * @example
   *  page.on("dialog", (dialog) => dialog.accept());
   */
  public on<E extends PageEventName>(event: E, listener: (...args: PageEvents[E]) => void): this {
    this.pageEvents.on(event, listener as (...args: unknown[]) => void);
    this.trackInBackground(event);
    return this;
  }

  public once<E extends PageEventName>(event: E, listener: (...args: PageEvents[E]) => void): this {
    this.pageEvents.once(event, listener as (...args: unknown[]) => void);
    this.trackInBackground(event);
    return this;
  }

  public off<E extends PageEventName>(event: E, listener: (...args: PageEvents[E]) => void): this {
    this.pageEvents.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  private trackInBackground(event: PageEventName) {
    const started =
      event === "dialog"
        ? this.startDialogHandling()
        : event === "download"
          ? this.startDownloadTracking()
          : event === "filechooser"
            ? this.startFileChooserTracking()
            : event === "console" || event === "pageerror"
          ? this.startLogging()
          : event === "response"
            ? Promise.all([this.startNetworkTracking(), this.startBodyCollection()])
            : this.startNetworkTracking();
    started.catch((err) => logger.error("Could not start listening for %s", event, { err }));
  }

  /** Starts following downloads; the browser does this when it opens a page, `page.on("download")` and `waitForDownload` when needed */
  public async startDownloadTracking(): Promise<void> {
    this.downloadTracker ??= (async () => {
      const timeout = (await this.navigationSettings()).timeout ?? DEFAULT_NAVIGATION_TIMEOUT;
      const tracker = await DownloadTracker.start(this.biDiConnector, await this.tree(), this.id, { timeout });
      tracker.on("download", (download) => this.pageEvents.emit("download", download));
      return tracker;
    })().catch((err) => {
      this.downloadTracker = undefined;
      throw err;
    });
    await this.downloadTracker;
  }

  /** Starts following file pickers; the browser does this when it opens a page, `page.on("filechooser")` and `waitForFileChooser` when needed */
  public async startFileChooserTracking(): Promise<void> {
    this.fileChooserTracker ??= (async () => {
      const tracker = await FileChooserTracker.start(this.biDiConnector, await this.tree(), this.id);
      tracker.on("filechooser", (chooser) => this.pageEvents.emit("filechooser", chooser));
      return tracker;
    })().catch((err) => {
      this.fileChooserTracker = undefined;
      throw err;
    });
    await this.fileChooserTracker;
  }

  /**
   * Resolves with the next download this page starts (when it starts, not when it ends: use `download.path()` for that).
   * Call it before the download is triggered, or pass `trigger`, which runs once the wait is set up.
   * @example
   *  const download = await page.waitForDownload({ trigger: () => link.click() });
   *  const file = await download.path();
   */
  public async waitForDownload(options: { timeout?: number; trigger?: () => Promise<unknown> } = {}): Promise<Download> {
    this.assertOpen();
    await this.startDownloadTracking();
    return this.waitForPageEvent("download", () => true, options, (timeout) => new DownloadWaitTimeoutError(timeout));
  }

  /**
   * Resolves with the next file picker the page opens (a click on an `<input type=file>` or its label). Nothing shows
   * on screen: answer it with `chooser.setFiles(...)`.
   * @example
   *  const chooser = await page.waitForFileChooser({ trigger: () => page.locator("label[@for='avatar']").click() });
   *  await chooser.setFiles("./fixtures/avatar.png");
   */
  public async waitForFileChooser(options: { timeout?: number; trigger?: () => Promise<unknown> } = {}): Promise<FileChooser> {
    this.assertOpen();
    await this.startFileChooserTracking();
    return this.waitForPageEvent("filechooser", () => true, options, (timeout) => new FileChooserTimeoutError(timeout));
  }

  /**
   * Starts keeping response bodies, which is what makes `response.body()` possible: the browser only keeps a body
   * when this ran before the request started. `page.on("response")` and `waitForResponse` call it; config
   * `network.collectBodies` calls it when the browser opens the page.
   */
  public async startBodyCollection(): Promise<void> {
    this.collectorPromise ??= (async () => {
      const { maxBodySize } = await this.networkSettings();
      return DataCollector.start(this.biDiConnector, this.id, {
        ...(maxBodySize !== undefined && { maxBodySize }),
      });
    })().catch((err) => {
      this.collectorPromise = undefined;
      throw err;
    });
    await this.collectorPromise;
  }

  /** One Response per network response, whoever asks, so a body is read from the browser once */
  private responseFor(data: NetworkResponse): Response {
    let response = this.responses.get(data);
    if (!response) {
      response = new Response(data, (loaded) => this.loadBody(loaded));
      this.responses.set(data, response);
    }
    return response;
  }

  private async loadBody(response: Response): Promise<Buffer> {
    if (!this.collectorPromise) {
      throw new ResponseBodyUnavailableError(
        response.url,
        "no body collection was running: call page.startBodyCollection() before the request, or listen with page.on('response')",
      );
    }
    const collector = await this.collectorPromise;
    const body = await collector.read(response.id, response.url);
    void collector.release(response.id);
    return body;
  }

  /**
   * Resolves with the next response of this page whose URL matches (a pattern, see `route`) or that the function
   * accepts. Call it before the request is made, or pass `trigger`, which runs once the wait is set up.
   * @example
   *  const response = await page.waitForResponse("**\/api/users", { trigger: () => button.click() });
   *  const users = await response.json();
   */
  public async waitForResponse(
    match: NetworkMatch<Response>,
    options: { timeout?: number; trigger?: () => Promise<unknown> } = {},
  ): Promise<Response> {
    await Promise.all([this.network(), this.startBodyCollection()]);
    return this.waitForNetworkEvent("response", match, options);
  }

  /** Like `waitForResponse`, for requests */
  public async waitForRequest(
    match: NetworkMatch<NetworkRequest>,
    options: { timeout?: number; trigger?: () => Promise<unknown> } = {},
  ): Promise<NetworkRequest> {
    await this.network();
    return this.waitForNetworkEvent("request", match, options);
  }

  private waitForNetworkEvent<E extends "request" | "response">(
    event: E,
    match: NetworkMatch<NetworkEvents[E][0]>,
    options: { timeout?: number; trigger?: () => Promise<unknown> },
  ): Promise<NetworkEvents[E][0]> {
    const matches = toPredicate(match as NetworkMatch<{ url: string }>) as (item: NetworkEvents[E][0]) => boolean;
    const Timeout = event === "request" ? RequestTimeoutError : ResponseTimeoutError;
    return this.waitForPageEvent(event, matches, options, (timeout) =>
      new Timeout(event === "request" ? "waitForRequest" : "waitForResponse", match as never, timeout),
    );
  }

  /**
   * Resolves with the first `event` `matches` accepts. Listens before `trigger` runs, so what the trigger causes cannot
   * be missed; a trigger that throws rejects the wait with its error. `onTimeout` builds the error for a wait that ran out.
   */
  private async waitForPageEvent<E extends keyof PageEvents>(
    event: E,
    matches: (item: PageEvents[E][0]) => boolean,
    options: { timeout?: number; trigger?: () => Promise<unknown> },
    onTimeout: (timeout: number) => Error,
  ): Promise<PageEvents[E][0]> {
    const timeout =
      options.timeout ?? (await this.navigationSettings()).timeout ?? DEFAULT_NAVIGATION_TIMEOUT;
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        this.pageEvents.off(event, listener);
      };
      const listener = (item: PageEvents[E][0]) => {
        try {
          if (!matches(item)) return;
        } catch (err) {
          done();
          reject(err);
          return;
        }
        done();
        resolve(item);
      };
      const timer = setTimeout(() => {
        done();
        reject(onTimeout(timeout));
      }, timeout);
      this.pageEvents.on(event, listener as (...args: unknown[]) => void);
      const { trigger } = options;
      if (trigger) {
        Promise.resolve()
          .then(trigger)
          .catch((err) => {
            done();
            reject(err);
          });
      }
    });
  }

  /** Turns the browser's HTTP cache off (`true`) or back on for this page: every request then goes to the server */
  public async setCacheDisabled(disabled: boolean): Promise<void> {
    try {
      await this.biDiConnector.send("network.setCacheBehavior", {
        cacheBehavior: disabled ? "bypass" : "default",
        contexts: [this.id],
      });
    } catch (err) {
      if (err instanceof BiDiError && (err.code === "unsupported operation" || err.code === "unknown command")) {
        throw new UnsupportedOperationError("page.setCacheDisabled() is not supported by the browser");
      }
      throw err;
    }
  }

  private router(): Promise<Router> {
    this.routerPromise ??= (async () => {
      const routeTimeout = (await this.networkSettings()).routeTimeout;
      const router = new Router(this.biDiConnector, await this.tree(), this.id, {
        ...(routeTimeout !== undefined && { routeTimeout }),
      });
      this.loadedRouter = router;
      return router;
    })().catch((err) => {
      this.routerPromise = undefined;
      throw err;
    });
    return this.routerPromise;
  }

  /**
   * Sends requests whose URL matches to `handler`, which must answer with `route.fulfill()`, `route.continue()`,
   * `route.abort()` or `route.fallback()` (await the answer: a handler that returns first lets the request continue).
   * A string without `*` is an exact URL, with `*` / `**` a glob (`*` stops at `/`), a RegExp is tested on the URL.
   * Routes added later are asked first. Errors a handler throws fail the request and, in the runner, the test.
   * @example
   *  await page.route("**\/api/users", (route) => route.fulfill({ json: [{ id: 1 }] }));
   *  await page.route(/\.(png|jpg)$/, (route) => route.abort());
   */
  public async route(url: UrlPattern, handler: RouteHandler): Promise<void> {
    this.assertOpen();
    await (await this.router()).route(url, handler);
  }

  /** Removes the routes for `url` (only the one with `handler`, when given) */
  public async unroute(url: UrlPattern, handler?: RouteHandler): Promise<void> {
    if (!this.routerPromise) return;
    await (await this.router()).unroute(url, handler);
  }

  public async unrouteAll(): Promise<void> {
    if (!this.routerPromise) return;
    await (await this.router()).unrouteAll();
  }

  /** Errors thrown by route handlers so far */
  public routeErrors(): readonly Error[] {
    return this.loadedRouter?.errors ?? [];
  }

  /**
   * Starts collecting the page's console output and uncaught exceptions. The browser does this when it opens a page so
   * early output is kept; `page.on("console" | "pageerror")` starts it when needed.
   */
  public async startLogging(): Promise<void> {
    this.pageLogs ??= (async () => {
      const logs = await PageLogs.start(this.biDiConnector, await this.tree(), this.id);
      logs.on("console", (message) => this.pageEvents.emit("console", message));
      logs.on("pageerror", (error) => this.pageEvents.emit("pageerror", error));
      this.loadedLogs = logs;
      return logs;
    })().catch((err) => {
      this.pageLogs = undefined;
      throw err;
    });
    await this.pageLogs;
  }

  /** The newest console and error entries of this page (empty until logging started), oldest first */
  public getLogs(): readonly LogRecord[] {
    return this.loadedLogs?.entries ?? [];
  }

  /** Uncaught exceptions of the page since logging started or `clearLogs()` */
  public pageErrors(): readonly PageError[] {
    return this.loadedLogs?.errors ?? [];
  }

  /** How many entries fell out of the page's log buffer */
  public get logsDropped(): number {
    return this.loadedLogs?.dropped ?? 0;
  }

  public clearLogs(): void {
    this.loadedLogs?.clear();
  }

  /** Resolves once everything the page logged before the call has arrived: events and replies share one ordered connection */
  public async syncLogs(): Promise<void> {
    await this.biDiConnector.send("session.status", {});
  }

  /** Tells the runner not to fail this test on uncaught page exceptions (config `logs.failOnPageError`) */
  public allowPageErrors(): void {
    this.errorsAllowed = true;
  }

  public get pageErrorsAllowed(): boolean {
    return this.errorsAllowed;
  }

  /** Starts watching for dialogs; the browser does this when it opens a page, `page.on("dialog")` when needed */
  public async startDialogHandling(): Promise<void> {
    this.dialogHandling ??= (async () => {
      await this.tree();
      this.biDiConnector.onEvent("browsingContext.userPromptOpened", this.onPromptOpened);
      this.biDiConnector.onEvent("browsingContext.userPromptClosed", this.onPromptClosed);
      try {
        return await this.biDiConnector.subscribe([
          "browsingContext.userPromptOpened",
          "browsingContext.userPromptClosed",
        ]);
      } catch (err) {
        this.biDiConnector.offEvent("browsingContext.userPromptOpened", this.onPromptOpened);
        this.biDiConnector.offEvent("browsingContext.userPromptClosed", this.onPromptClosed);
        this.dialogHandling = undefined;
        throw err;
      }
    })();
    await this.dialogHandling;
  }

  private ownsContext(context: string): boolean {
    return this.loadedTree?.isWithin(context, this.id) ?? context === this.id;
  }

  private onPromptOpened = (params: UserPromptOpenedParameters) => {
    if (!this.ownsContext(params.context)) return;
    this.dispatchDialog(new Dialog(this.biDiConnector, this.id, params), params).catch((err) =>
      logger.error("Handling a dialog failed", { err }),
    );
  };

  private onPromptClosed = (params: UserPromptClosedParameters) => {
    if (!this.ownsContext(params.context)) return;
    const dialog = this.openDialogs.get(params.context);
    this.openDialogs.delete(params.context);
    dialog?.markClosed({
      accepted: params.accepted,
      ...(params.userText !== undefined && { userText: params.userText }),
    });
  };

  /** Lets the listeners answer; a dialog still open afterwards gets the default answer, so nothing hangs */
  private async dispatchDialog(dialog: Dialog, params: UserPromptOpenedParameters) {
    this.openDialogs.set(params.context, dialog);
    // rawListeners: the wrappers that make a `once` listener remove itself when called
    const listeners = this.pageEvents.rawListeners("dialog") as Array<(dialog: Dialog) => unknown>;
    await Promise.all(
      listeners.map(async (listener) => {
        try {
          await listener(dialog);
        } catch (err) {
          logger.error("A dialog listener threw", { err });
        }
      }),
    );
    if (dialog.handled) return;
    // Staying on a page is not what a test that navigates wants: leave it, dismiss everything else
    const accept = params.type === "beforeunload";
    logger.warn(
      'Dialog "%s" was %s automatically; add page.on("dialog") to handle it',
      params.message,
      accept ? "accepted" : "dismissed",
    );
    await (accept ? dialog.accept() : dialog.dismiss());
  }

  /** Captures an image of the given navigable, and returns it as a Base64-encoded string */
  public async captureScreenshot(
    clip?: BiDiCommands["browsingContext.captureScreenshot"]["params"]["clip"],
    format?: BiDiCommands["browsingContext.captureScreenshot"]["params"]["format"],
    origin?: BiDiCommands["browsingContext.captureScreenshot"]["params"]["origin"],
  ) {
    const screenshot = await this.biDiConnector.send(
      "browsingContext.captureScreenshot",
      {
        context: this.id,
        clip,
        format,
        origin,
      },
    );
    // TODO: Store screenshot according to config specs
  }
}

/** Wraps an init script as one function declaration; the argument is embedded as JSON because preload scripts take no arguments */
function initScriptSource(script: string | ((arg?: any) => void), arg: unknown): string {
  if (typeof script === "string") {
    if (arg !== undefined) {
      throw new TypeError("addInitScript(): a string script does not take an argument; pass a function instead");
    }
    return `() => {\n${script}\n}`;
  }
  const declaration = toFunctionDeclaration(script);
  const argument = arg === undefined ? "undefined" : JSON.stringify(arg);
  if (argument === undefined) {
    throw new TypeError("addInitScript(): the argument must be JSON-serializable");
  }
  return `() => (${declaration})(${argument})`;
}
