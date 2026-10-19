import Locator from "../locator/locator.js";
import type { TextOptions } from "../locator/selector.js";
import {
  cssSelector,
  labelSelector,
  roleSelector,
  testIdSelector,
  textSelector,
} from "../locator/selector.js";
import EventEmitter from "node:events";
import path from "node:path";
import { projectDir } from "../config/config.js";
import { peekRunSettings } from "../config/run-settings.js";
import logger from "../logger/index.js";
import type { NetworkRequest } from "../network/network-tracker.js";
import type { Recorder, RecorderOptions } from "../recorder/recorder.js";
import { ContextTree } from "./context-tree.js";
import type { BrowserContext } from "./browser-context.js";
import { printPdf, type PdfOptions } from "./pdf.js";
import { applyEmulation, type EmulationOptions } from "./emulation.js";
import type { Download } from "./download.js";
import type { FileChooser } from "./file-chooser.js";
import {
  takeScreenshot,
  writeOutput,
  type ScreenshotOptions,
} from "./screenshot.js";
import { Evidence } from "./evidence.js";
import { PageLogs, type LogRecord, type PageError } from "./page-logs.js";
import { Lazy } from "./lazy.js";
import type { RouteHandler } from "../network/router.js";
import { Response } from "../network/response.js";
import type { NetworkMatch } from "../network/network-wait.js";
import { UnsupportedOperationError } from "../transport/unsupported.js";
import type { UrlPattern } from "../network/url-match.js";
import { traverseHistory } from "./history.js";
import { DialogHandling } from "./dialog-handling.js";
import { DocumentWatcher } from "./document-watcher.js";
import { PageNetwork } from "./page-network.js";
import { PageTransfers } from "./page-transfers.js";
import { initScriptSource } from "./init-script.js";
import {
  sourcesFor,
  waitForPageEvent,
  type EventSource,
  type PageEventName,
  type PageEvents,
  type WaitableEventName,
  type WaitForEventOptions,
  type WaitOptions,
} from "./page-events.js";
export type {
  PageEventName,
  WaitableEventName,
  WaitForEventOptions,
  WaitOptions,
};
import {
  PageConfig,
  type PageSettings,
  type ReadinessState,
} from "./page-settings.js";
export type { PageSettings, ReadinessState };
import { applyViewport, DEFAULT_VIEWPORT, type Viewport } from "./viewport.js";
import { HelperRealm } from "../locator/helper-realm.js";
import { addPreload, type PreloadHandle } from "../script/preload.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import { WaitTimeoutError } from "../wait/wait-until.js";
import { LoadStateTimeoutError, NavigationError } from "./navigation-error.js";
import { callFunction } from "../script/call-function.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";

export type LoadState = "load" | "domcontentloaded" | "networkidle";

export interface NavigateOptions {
  /** When navigateTo resolves. @default config `navigation.waitUntil`, then "complete" */
  wait?: ReadinessState;
  /** Time (ms) the navigation may take. @default config `navigation.timeout`, then 30000 */
  timeout?: number;
  /** Scheme added to a URL without one. @default "https" */
  protocol?: "http" | "https";
}

/** What a navigation answers with: its id (null when the browser gave none) and the URL it ended on */
export type NavigationResult = { navigation: string | null; url: string };

export default class Page {
  private biDiConnector: BiDiConnector;
  private id: BrowsingContext;
  private lazyTree = new Lazy<ContextTree>();
  private helperRealm: HelperRealm;
  private initScripts = new Set<PreloadHandle>();
  private pageConfig: PageConfig;
  private pageEvents = new EventEmitter();
  /** The navigation started by the last navigateTo; failures of it fail a wait */
  private lastNavigation: string | undefined;
  /** Base for relative page.goto URLs; falls back to the active run's baseURL */
  private baseURL: string | undefined;
  private documents: DocumentWatcher;
  private net: PageNetwork;
  private dialogs: DialogHandling;
  private lazyLogs = new Lazy<PageLogs>();
  private errorsAllowed = false;
  private isClosed = false;
  private browserContext: BrowserContext | undefined;
  private transfers: PageTransfers;
  private evidence: Evidence | undefined;

  /** `settings` override what `samurai.config.ts` says; without them the config is read when needed */
  constructor(
    biDiConnector: BiDiConnector,
    contextId: string,
    settings?: PageSettings,
  ) {
    this.biDiConnector = biDiConnector;
    this.id = contextId;
    this.pageConfig = new PageConfig(settings);
    this.helperRealm = new HelperRealm(biDiConnector, contextId);
    this.documents = new DocumentWatcher(biDiConnector, contextId);
    this.net = new PageNetwork(biDiConnector, contextId, {
      config: this.pageConfig,
      tree: { ensure: () => this.tree(), peek: () => this.lazyTree.peek() },
      emitter: this.pageEvents,
      waitForEvent: (event, matches, options, onTimeout) =>
        this.waitForPageEvent(event, matches, options, onTimeout),
    });
    this.transfers = new PageTransfers(biDiConnector, contextId, {
      config: this.pageConfig,
      tree: { ensure: () => this.tree(), peek: () => this.lazyTree.peek() },
      emitter: this.pageEvents,
      waitForEvent: (event, matches, options, onTimeout) =>
        this.waitForPageEvent(event, matches, options, onTimeout),
    });
    this.dialogs = new DialogHandling(
      biDiConnector,
      contextId,
      { ensure: () => this.tree(), peek: () => this.lazyTree.peek() },
      this.pageEvents,
    );
  }

  /** The BiDi browsing context id of this page's top-level context */
  public get contextId(): BrowsingContext {
    return this.id;
  }

  /** The context tree, created on first use and shared by everything that needs to attribute frame events to this page */
  public tree(): Promise<ContextTree> {
    return this.lazyTree.get(() => ContextTree.create(this.biDiConnector));
  }
  /** Locates an element on the page and returns an interactable object */
  public locator(xpath: string) {
    return this.locate(xpath);
  }

  private locate(selector: ConstructorParameters<typeof Locator>[0]): Locator {
    this.assertOpen();
    return new Locator(selector, this.biDiConnector, this.id, this.helperRealm);
  }

  /** Locates elements with a CSS selector */
  public getByCss(css: string) {
    return this.locate([cssSelector(css)]);
  }

  /** Locates elements by their text: an exact match unless `match: "partial"` */
  public getByText(text: string, options?: TextOptions) {
    return this.locate([textSelector(text, options)]);
  }

  /** Locates form controls by their label text: an exact match unless `match: "partial"` */
  public getByLabel(text: string, options?: TextOptions) {
    return this.locate([labelSelector(text, options)]);
  }

  /** Locates elements by their `data-testid` attribute */
  public getByTestId(testId: string) {
    return this.locate([testIdSelector(testId)]);
  }

  /** Locates elements by ARIA role and, optionally, accessible name */
  public getByRole(role: string, options?: { name?: string }) {
    return this.locate([roleSelector(role, options)]);
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
  public async record(options: RecorderOptions): Promise<Recorder> {
    this.assertOpen();
    // Loaded when asked for: the recorder is built on Page, so a static import would be a loop
    const { Recorder } = await import("../recorder/recorder.js");
    return Recorder.start(
      { page: this, connector: this.biDiConnector, context: this.id },
      options,
    );
  }

  /** Removes everything the page registered in the browser: init scripts, framework helpers and event subscriptions */
  public async dispose(): Promise<void> {
    const scripts = [...this.initScripts];
    const results = await Promise.allSettled([
      ...scripts.map((handle) => handle.dispose()),
      this.helperRealm.dispose(),
      // The tracker goes before the tree it reads
      this.net.disposeTracker(),
    ]);
    const tree = this.lazyTree.take();
    const pageLogs = this.lazyLogs.take();
    results.push(
      ...(await Promise.allSettled([
        tree?.then((resolved) => resolved.dispose()),
        this.documents.dispose(),
        this.dialogs.dispose(),
        pageLogs?.then((logs) => logs.dispose()),
        ...this.net.disposeRest(),
        ...this.transfers.dispose(),
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
  ): Promise<NavigationResult> {
    if (!/^\.{0,2}\//.test(url)) return this.navigateTo(url, options);
    const base = this.baseURL ?? peekRunSettings()?.baseURL;
    if (!base) {
      throw new Error(
        `page.goto("${url}") needs a baseURL; set one in samurai.config.ts or the environment`,
      );
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
  ): Promise<NavigationResult> {
    const given: NavigateOptions =
      typeof options === "string" ? { wait: options } : (options ?? {});
    const wait = await this.pageConfig.navigationWait(given.wait);
    const timeout = await this.pageConfig.navigationTimeout(given.timeout);
    // A scheme is letters followed by ":" not directly followed by a digit, so "localhost:3000" is a host
    const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(url);
    const parsedURL = hasScheme
      ? url
      : `${given.protocol ?? protocol ?? "https"}://${url}`;
    this.assertOpen();
    return this.navigation(
      "navigateTo",
      async () => parsedURL,
      wait,
      timeout,
      async (sendOptions) => {
        const result = await this.biDiConnector.send(
          "browsingContext.navigate",
          { context: this.id, url: parsedURL, wait },
          sendOptions,
        );
        return {
          navigation: result.navigation ?? null,
          url: result.url ?? parsedURL,
        };
      },
    );
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
    send: (options: { timeout: number }) => Promise<NavigationResult>,
  ): Promise<NavigationResult> {
    // A navigation that does not wait for the load needs watching, or waitForLoadState cannot tell it from the old page
    if (wait !== "complete") await this.documents.watch();
    try {
      const result = await send({ timeout });
      this.lastNavigation = result.navigation ?? undefined;
      if (result.navigation && wait !== "complete") {
        // Tracked from now on: the document still showing is the old one until this navigation commits
        const progress = this.documents.progressOf(result.navigation);
        if (wait === "interactive") progress.domContentLoaded = true;
      }
      return result;
    } catch (err) {
      if (err instanceof BiDiError) {
        const reason =
          err.code === "timeout" ? `timeout after ${timeout}ms` : err.message;
        throw new NavigationError(
          await describe(),
          reason,
          err.code,
          operation,
        );
      }
      throw err;
    }
  }

  /**
   * Reloads the page and resolves when it reached `wait` (default like `navigateTo`). Firefox does not support
   * `ignoreCache`; asking for it throws UnsupportedOperationError.
   */
  public async reload(
    options: {
      wait?: ReadinessState;
      timeout?: number;
      ignoreCache?: boolean;
    } = {},
  ): Promise<NavigationResult> {
    this.assertOpen();
    const wait = await this.pageConfig.navigationWait(options.wait);
    const timeout = await this.pageConfig.navigationTimeout(options.timeout);
    return this.navigation(
      "reload",
      () => this.url().catch(() => "the page"),
      wait,
      timeout,
      async (sendOptions) => {
        try {
          const result = await this.biDiConnector.send(
            "browsingContext.reload",
            {
              context: this.id,
              wait,
              ...(options.ignoreCache && { ignoreCache: true }),
            },
            sendOptions,
          );
          return { navigation: result.navigation ?? null, url: result.url };
        } catch (err) {
          if (
            options.ignoreCache &&
            err instanceof BiDiError &&
            err.code === "unsupported operation"
          ) {
            throw new UnsupportedOperationError(
              "reload({ ignoreCache }) is not supported by the browser",
            );
          }
          throw err;
        }
      },
    );
  }

  /** Goes back one entry in the history. False when there is none to go back to */
  public async goBack(): Promise<boolean> {
    this.assertOpen();
    return traverseHistory(this.biDiConnector, this.id, -1);
  }

  /** Goes forward one entry in the history. False when there is none */
  public async goForward(): Promise<boolean> {
    this.assertOpen();
    return traverseHistory(this.biDiConnector, this.id, 1);
  }

  /** The URL of the page now */
  public async url(): Promise<string> {
    this.assertOpen();
    return callFunction<string>(
      this.biDiConnector,
      this.id,
      "() => location.href",
      [],
      { awaitPromise: false },
    );
  }

  /** The title of the document now */
  public async title(): Promise<string> {
    this.assertOpen();
    return callFunction<string>(
      this.biDiConnector,
      this.id,
      "() => document.title",
      [],
      { awaitPromise: false },
    );
  }

  /**
   * Sets the size of the viewport (and, optionally, the device pixel ratio); `null` puts the browser's own size back.
   * @example
   *  await page.setViewport({ width: 390, height: 844, devicePixelRatio: 3 });
   */
  public async setViewport(viewport: Viewport | null): Promise<void> {
    this.assertOpen();
    await applyViewport(this.biDiConnector, this.id, viewport);
  }

  /** Gives the page the size from config `use.viewport` (1280x720 by default); the browser does this when it opens a page */
  public async applyDefaultViewport(): Promise<void> {
    const { viewport } = await this.pageConfig.use();
    if (viewport === null) return;
    await this.setViewport(viewport ?? DEFAULT_VIEWPORT);
  }

  /**
   * What the browser sets up on every page it opens: the default size, then everything that has to be listening
   * before the page does anything (requests, dialogs, logs, downloads, file pickers). Safe to call again.
   */
  public async startTracking(): Promise<void> {
    await this.applyDefaultViewport();
    await this.startNetworkTracking();
    await this.startDialogHandling();
    await this.startLogging();
    await this.startDownloadTracking();
    await this.startFileChooserTracking();
  }

  /**
   * Takes a screenshot and returns the image (also written to `options.path`).
   * @example
   *  await page.screenshot({ path: "out/home.png", fullPage: true });
   */
  public async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    this.assertOpen();
    const image = await takeScreenshot(this.biDiConnector, this.id, options);
    if (options.name !== undefined) {
      const evidence =
        this.evidence ?? new Evidence(path.join(projectDir(), "result"));
      await writeOutput(
        evidence.fileFor(options.name, options.type).file,
        image,
      );
    }
    return image;
  }

  /** @internal The runner gives each test its own evidence folder */
  public setEvidence(evidence: Evidence | undefined): void {
    this.evidence = evidence;
  }

  /** Waits `ms` milliseconds. Prefer waiting for something (an assertion, `waitForNetworkIdle`) when you can */
  public async waitForTimeout(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0)
      throw new RangeError(
        `waitForTimeout needs 0 or more milliseconds, got ${ms}`,
      );
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Renders the page as a PDF and returns it (also written to `options.path`) */
  public async pdf(options: PdfOptions = {}): Promise<Buffer> {
    this.assertOpen();
    return printPdf(this.biDiConnector, this.id, options);
  }

  /** The browser context (cookies, storage) this page belongs to */
  public context(): BrowserContext {
    if (!this.browserContext)
      throw new Error(
        "this page has no browser context: open it with browser.newPage() or context.newPage()",
      );
    return this.browserContext;
  }

  /** @internal Called when the page is opened in a context */
  public setContext(context: BrowserContext): void {
    this.browserContext = context;
  }

  /** @internal Marks the page closed after its tab is gone (its context was removed) and releases what it registered */
  public async detach(): Promise<void> {
    this.isClosed = true;
    await this.dispose().catch((err) =>
      logger.debug("Releasing a detached page failed", { err }),
    );
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
  public async grantPermission(
    name: string,
    options: { origin?: string } = {},
  ): Promise<void> {
    this.assertOpen();
    const origin = options.origin ?? new URL(await this.url()).origin;
    // about:blank and data: pages have no origin to grant to
    if (origin === "null")
      throw new Error(
        "grantPermission() needs a page on a web origin, or an explicit origin option",
      );
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
  public async close(
    options: { runBeforeUnload?: boolean } = {},
  ): Promise<void> {
    if (this.isClosed) return;
    try {
      await this.biDiConnector.send("browsingContext.close", {
        context: this.id,
        ...(options.runBeforeUnload && { promptUnload: true }),
      });
    } catch (err) {
      // Already gone (closed by the page, the browser or another call): the goal is met
      if (!(err instanceof BiDiError && err.code === "no such frame"))
        throw err;
    }
    this.isClosed = true;
    await this.dispose().catch((err) =>
      logger.debug("Releasing a closed page failed", { err }),
    );
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
    const timeout = await this.pageConfig.navigationTimeout(options.timeout);
    try {
      await this.documents.waitForState(
        state === "domcontentloaded" ? "domcontentloaded" : "load",
        timeout,
        this.lastNavigation,
      );
    } catch (err) {
      if (err instanceof WaitTimeoutError)
        throw new LoadStateTimeoutError(state, timeout);
      throw err;
    }
    if (state === "networkidle") await this.net.waitForIdle({ timeout });
  }

  /**
   * Starts following this page's requests now. Tracking only sees requests made after it started, so the
   * browser calls this when it opens a page; without it, tracking starts on first use. Does nothing when
   * config `network.track` is false.
   */
  public startNetworkTracking(): Promise<void> {
    return this.net.startTracking();
  }

  /**
   * Waits until no request has been in flight for `idleTime` ms (default config `network.idleTime`, then 500).
   * Long-lived requests (server-sent events, long polling) keep the page busy until `timeout`.
   */
  public waitForNetworkIdle(
    options: { idleTime?: number; timeout?: number } = {},
  ): Promise<void> {
    return this.net.waitForIdle(options);
  }

  /**
   * Listens for page events: `request`, `response`, `requestfailed` (network), `dialog` (a JavaScript dialog or
   * `beforeunload` prompt opened; answer it with `dialog.accept()` / `dialog.dismiss()`), `console` (a `console.*` call)
   * and `pageerror` (an uncaught exception). Starts what the event needs.
   * A dialog nobody answers is dismissed automatically (a `beforeunload` prompt is accepted), so it cannot hang a test.
   * @example
   *  page.on("dialog", (dialog) => dialog.accept());
   */
  public on<E extends PageEventName>(
    event: E,
    listener: (...args: PageEvents[E]) => void,
  ): this {
    this.pageEvents.on(event, listener as (...args: unknown[]) => void);
    this.trackInBackground(event);
    return this;
  }

  public once<E extends PageEventName>(
    event: E,
    listener: (...args: PageEvents[E]) => void,
  ): this {
    this.pageEvents.once(event, listener as (...args: unknown[]) => void);
    this.trackInBackground(event);
    return this;
  }

  public off<E extends PageEventName>(
    event: E,
    listener: (...args: PageEvents[E]) => void,
  ): this {
    this.pageEvents.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  private trackInBackground(event: PageEventName) {
    const start: Record<EventSource, () => Promise<unknown>> = {
      dialogs: () => this.startDialogHandling(),
      downloads: () => this.startDownloadTracking(),
      filechoosers: () => this.startFileChooserTracking(),
      logs: () => this.startLogging(),
      network: () => this.startNetworkTracking(),
      bodies: () => this.startBodyCollection(),
    };
    Promise.all(sourcesFor(event).map((source) => start[source]())).catch(
      (err) => logger.error("Could not start listening for %s", event, { err }),
    );
  }

  /** Starts following downloads; the browser does this when it opens a page, `page.on("download")` and `waitForDownload` when needed */
  public startDownloadTracking(): Promise<void> {
    return this.transfers.startDownloadTracking();
  }

  /** Starts following file pickers; the browser does this when it opens a page, `page.on("filechooser")` and `waitForFileChooser` when needed */
  public startFileChooserTracking(): Promise<void> {
    return this.transfers.startFileChooserTracking();
  }

  /**
   * Resolves with the next download this page starts (when it starts, not when it ends: use `download.path()` for that).
   * Call it before the download is triggered, or pass `trigger`, which runs once the wait is set up.
   * @example
   *  const download = await page.waitForDownload({ trigger: () => link.click() });
   *  const file = await download.path();
   */
  public async waitForDownload(options: WaitOptions = {}): Promise<Download> {
    this.assertOpen();
    return this.transfers.waitForDownload(options);
  }

  /**
   * Resolves with the next file picker the page opens (a click on an `<input type=file>` or its label). Nothing shows
   * on screen: answer it with `chooser.setFiles(...)`.
   * @example
   *  const chooser = await page.waitForFileChooser({ trigger: () => page.locator("label[@for='avatar']").click() });
   *  await chooser.setFiles("./fixtures/avatar.png");
   */
  public async waitForFileChooser(
    options: WaitOptions = {},
  ): Promise<FileChooser> {
    this.assertOpen();
    return this.transfers.waitForFileChooser(options);
  }

  /**
   * Playwright-style wait for one page event: `download`, `filechooser`, `request` or `response`. Same as the named
   * `waitFor…` method, with an optional predicate (a function, or `predicate` in the options). Call it before the event
   * is caused, or pass `trigger`, which runs once the wait is set up.
   * @example
   *  const chooser = await page.waitForEvent("filechooser", { trigger: () => page.getByText("Upload file").click() });
   *  await chooser.setFiles("./myfile.pdf");
   */
  public async waitForEvent<E extends WaitableEventName>(
    event: E,
    optionsOrPredicate:
      | ((item: PageEvents[E][0]) => boolean)
      | WaitForEventOptions<PageEvents[E][0]> = {},
  ): Promise<PageEvents[E][0]> {
    const { predicate, ...options } =
      typeof optionsOrPredicate === "function"
        ? { predicate: optionsOrPredicate }
        : optionsOrPredicate;
    const accepts = (predicate ?? (() => true)) as (item: unknown) => boolean;
    switch (event) {
      case "request":
        return this.waitForRequest(accepts, options) as Promise<
          PageEvents[E][0]
        >;
      case "response":
        return this.waitForResponse(accepts, options) as Promise<
          PageEvents[E][0]
        >;
      case "download":
        this.assertOpen();
        return this.transfers.waitForDownload(options, accepts) as Promise<
          PageEvents[E][0]
        >;
      case "filechooser":
        this.assertOpen();
        return this.transfers.waitForFileChooser(options, accepts) as Promise<
          PageEvents[E][0]
        >;
      default:
        throw new Error(
          `page.waitForEvent() does not support "${String(event)}": use page.on()`,
        );
    }
  }

  /**
   * Starts keeping response bodies, which is what makes `response.body()` possible: the browser only keeps a body
   * when this ran before the request started. `page.on("response")` and `waitForResponse` call it; config
   * `network.collectBodies` calls it when the browser opens the page.
   */
  public startBodyCollection(): Promise<void> {
    return this.net.startBodyCollection();
  }

  /**
   * Resolves with the next response of this page whose URL matches (a pattern, see `route`) or that the function
   * accepts. Call it before the request is made, or pass `trigger`, which runs once the wait is set up.
   * @example
   *  const response = await page.waitForResponse("**\/api/users", { trigger: () => button.click() });
   *  const users = await response.json();
   */
  public waitForResponse(
    match: NetworkMatch<Response>,
    options: WaitOptions = {},
  ): Promise<Response> {
    return this.net.waitForResponse(match, options);
  }

  /** Like `waitForResponse`, for requests */
  public waitForRequest(
    match: NetworkMatch<NetworkRequest>,
    options: WaitOptions = {},
  ): Promise<NetworkRequest> {
    return this.net.waitForRequest(match, options);
  }

  /**
   * Resolves with the first `event` `matches` accepts. Listens before `trigger` runs, so what the trigger causes cannot
   * be missed; a trigger that throws rejects the wait with its error. `onTimeout` builds the error for a wait that ran out.
   */
  private async waitForPageEvent<E extends PageEventName>(
    event: E,
    matches: (item: PageEvents[E][0]) => boolean,
    options: WaitOptions,
    onTimeout: (timeout: number) => Error,
  ): Promise<PageEvents[E][0]> {
    const timeout = await this.pageConfig.navigationTimeout(options.timeout);
    return waitForPageEvent(
      this.pageEvents,
      event,
      matches,
      options,
      timeout,
      onTimeout,
    );
  }

  /** Turns the browser's HTTP cache off (`true`) or back on for this page: every request then goes to the server */
  public setCacheDisabled(disabled: boolean): Promise<void> {
    return this.net.setCacheDisabled(disabled);
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
    await this.net.route(url, handler);
  }

  /** Removes the routes for `url` (only the one with `handler`, when given) */
  public unroute(url: UrlPattern, handler?: RouteHandler): Promise<void> {
    return this.net.unroute(url, handler);
  }

  public unrouteAll(): Promise<void> {
    return this.net.unrouteAll();
  }

  /** Errors thrown by route handlers so far */
  public routeErrors(): readonly Error[] {
    return this.net.routeErrors();
  }

  /**
   * Starts collecting the page's console output and uncaught exceptions. The browser does this when it opens a page so
   * early output is kept; `page.on("console" | "pageerror")` starts it when needed.
   */
  public async startLogging(): Promise<void> {
    await this.lazyLogs.get(async () => {
      const logs = await PageLogs.start(
        this.biDiConnector,
        await this.tree(),
        this.id,
      );
      logs.on("console", (message) => this.pageEvents.emit("console", message));
      logs.on("pageerror", (error) => this.pageEvents.emit("pageerror", error));
      return logs;
    });
  }

  /** The newest console and error entries of this page (empty until logging started), oldest first */
  public getLogs(): readonly LogRecord[] {
    return this.lazyLogs.peek()?.entries ?? [];
  }

  /** Uncaught exceptions of the page since logging started or `clearLogs()` */
  public pageErrors(): readonly PageError[] {
    return this.lazyLogs.peek()?.errors ?? [];
  }

  /** How many entries fell out of the page's log buffer */
  public get logsDropped(): number {
    return this.lazyLogs.peek()?.dropped ?? 0;
  }

  public clearLogs(): void {
    this.lazyLogs.peek()?.clear();
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
  public startDialogHandling(): Promise<void> {
    return this.dialogs.start();
  }
}
