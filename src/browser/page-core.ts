import type { APIRequestContext } from "../request/api-request-context.js";
import EventEmitter from "node:events";
import logger from "../logger/index.js";
import { ContextTree } from "./context-tree.js";
import type { BrowserContext } from "./browser-context.js";
import type { Evidence } from "./evidence.js";
import { PageLogging } from "./page-logging.js";
import { Lazy } from "./lazy.js";
import { DialogHandling } from "./dialog-handling.js";
import { DocumentWatcher } from "./document-watcher.js";
import { PageNavigation } from "./page-navigation.js";
import { PageNetwork } from "./page-network.js";
import { PageTransfers } from "./page-transfers.js";
import { InitScripts } from "./init-script.js";
import { PageLocators } from "./page-locators.js";
import Keyboard from "./keyboard.js";
import Mouse from "./mouse.js";
import {
  waitForPageEvent,
  type PageEventName,
  type PageEvents,
  type WaitOptions,
} from "./page-events.js";
import { PageConfig, type PageSettings } from "./page-settings.js";
import { PageViewport } from "./page-viewport.js";
import { HelperRealm } from "../locator/helper-realm.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";

/** @internal Page state and its wiring: the layers of `Page` build on it (see page.ts) */
export abstract class PageCore {
  protected biDiConnector: BiDiConnector;
  protected id: BrowsingContext;
  protected lazyTree = new Lazy<ContextTree>();
  protected helperRealm: HelperRealm;
  protected initScripts = new InitScripts();
  protected pageConfig: PageConfig;
  protected locators: PageLocators;
  /** Real key input to whatever has focus: `press` (also chords such as `Control+a`), `down`, `up`, `type`, `insertText` */
  public readonly keyboard: Keyboard;
  /** Real pointer input at viewport coordinates: `move`, `down`, `up`, `click`, `dblclick`, `wheel` */
  public readonly mouse: Mouse;
  protected pageEvents = new EventEmitter();
  protected documents: DocumentWatcher;
  protected nav: PageNavigation;
  protected net: PageNetwork;
  protected dialogs: DialogHandling;
  protected logging: PageLogging;
  protected isClosed = false;
  protected browserContext: BrowserContext | undefined;
  protected transfers: PageTransfers;
  protected evidence: Evidence | undefined;
  protected viewport: PageViewport;

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
    this.locators = new PageLocators(
      biDiConnector,
      contextId,
      this.helperRealm,
      this.pageConfig,
      () => this.assertOpen(),
    );
    this.keyboard = new Keyboard(biDiConnector, contextId, () =>
      this.assertOpen(),
    );
    this.mouse = new Mouse(biDiConnector, contextId, () => this.assertOpen());
    this.documents = new DocumentWatcher(biDiConnector, contextId);
    this.viewport = new PageViewport(biDiConnector, contextId, this.pageConfig);
    this.logging = new PageLogging(
      biDiConnector,
      contextId,
      () => this.tree(),
      this.pageEvents,
    );
    this.net = new PageNetwork(biDiConnector, contextId, {
      config: this.pageConfig,
      tree: { ensure: () => this.tree(), peek: () => this.lazyTree.peek() },
      emitter: this.pageEvents,
      waitForEvent: (event, matches, options, onTimeout) =>
        this.waitForPageEvent(event, matches, options, onTimeout),
    });
    this.nav = new PageNavigation(biDiConnector, contextId, {
      config: this.pageConfig,
      documents: this.documents,
      assertOpen: () => this.assertOpen(),
      url: () => this.url(),
      waitForNetworkIdle: (options) => this.net.waitForIdle(options),
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

  /** Removes everything the page registered in the browser: init scripts, framework helpers and event subscriptions */
  public async dispose(): Promise<void> {
    const scripts = this.initScripts.all();
    const results = await Promise.allSettled([
      ...scripts.map((handle) => handle.dispose()),
      this.helperRealm.dispose(),
      // The tracker goes before the tree it reads
      this.net.disposeTracker(),
    ]);
    const tree = this.lazyTree.take();
    const pageLogs = this.logging.take();
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

  /** @internal The runner gives each test its own evidence folder */
  public setEvidence(evidence: Evidence | undefined): void {
    this.evidence = evidence;
  }

  /** The browser context (cookies, storage) this page belongs to */
  public context(): BrowserContext {
    if (!this.browserContext)
      throw new Error(
        "this page has no browser context: open it with browser.newPage() or context.newPage()",
      );
    return this.browserContext;
  }

  /** Makes HTTP requests from the test with this page's cookies; the same as `page.context().request` */
  public get request(): APIRequestContext {
    return this.context().request;
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

  /** True once `close()` has run */
  public get closed(): boolean {
    return this.isClosed;
  }

  protected assertOpen() {
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

  public abstract url(): Promise<string>;
}
