import logger from "../logger/index.js";
import type { NetworkRequest } from "../network/network-tracker.js";
import type { Download } from "./download.js";
import type { FileChooser } from "./file-chooser.js";
import type { LogRecord, PageError } from "./page-logs.js";
import type { RouteHandler } from "../network/router.js";
import { Response } from "../network/response.js";
import type { NetworkMatch } from "../network/network-wait.js";
import type { UrlPattern } from "../network/url-match.js";
import {
  startSources,
  waitForEventOn,
  type EventSource,
  type PageEventName,
  type PageEvents,
  type WaitableEventName,
  type WaitForEventOptions,
  type WaitOptions,
} from "./page-events.js";
import { PageLocating } from "./page-locating.js";

/** @internal Events, network, routes, logs, dialogs and transfers */
export abstract class PageObserving extends PageLocating {
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
    startSources(event, start, (err) =>
      logger.error("Could not start listening for %s", event, { err }),
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
    return waitForEventOn(
      {
        request: (accepts, options) => this.waitForRequest(accepts, options),
        response: (accepts, options) => this.waitForResponse(accepts, options),
        download: (options, accepts) => {
          this.assertOpen();
          return this.transfers.waitForDownload(options, accepts);
        },
        filechooser: (options, accepts) => {
          this.assertOpen();
          return this.transfers.waitForFileChooser(options, accepts);
        },
      },
      event,
      optionsOrPredicate,
    );
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
    await this.logging.start();
  }

  /** The newest console and error entries of this page (empty until logging started), oldest first */
  public getLogs(): readonly LogRecord[] {
    return this.logging.entries();
  }

  /** Uncaught exceptions of the page since logging started or `clearLogs()` */
  public pageErrors(): readonly PageError[] {
    return this.logging.errors();
  }

  /** How many entries fell out of the page's log buffer */
  public get logsDropped(): number {
    return this.logging.dropped;
  }

  public clearLogs(): void {
    this.logging.clear();
  }

  /** Resolves once everything the page logged before the call has arrived: events and replies share one ordered connection */
  public async syncLogs(): Promise<void> {
    await this.biDiConnector.send("session.status", {});
  }

  /** Tells the runner not to fail this test on uncaught page exceptions (config `logs.failOnPageError`) */
  public allowPageErrors(): void {
    this.logging.allowErrors();
  }

  public get pageErrorsAllowed(): boolean {
    return this.logging.errorsAreAllowed;
  }

  /** Starts watching for dialogs; the browser does this when it opens a page, `page.on("dialog")` when needed */
  public startDialogHandling(): Promise<void> {
    return this.dialogs.start();
  }
}
