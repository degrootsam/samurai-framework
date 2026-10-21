import type EventEmitter from "node:events";
import {
  DEFAULT_COLLECT_BODIES,
  DEFAULT_TRACK_NETWORK,
} from "../config/defaults.js";
import {
  DataCollector,
  ResponseBodyUnavailableError,
} from "../network/data-collector.js";
import { NetworkTracker } from "../network/network-tracker.js";
import type {
  NetworkRequest,
  NetworkResponse,
} from "../network/network-tracker.js";
import {
  RequestTimeoutError,
  ResponseTimeoutError,
  toPredicate,
  type NetworkMatch,
} from "../network/network-wait.js";
import { Response } from "../network/response.js";
import { Router, type RouteHandler } from "../network/router.js";
import type { UrlPattern } from "../network/url-match.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import {
  isUnsupported,
  UnsupportedOperationError,
} from "../transport/unsupported.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";
import { Lazy } from "./lazy.js";
import type { TreeSource } from "./dialog-handling.js";
import type {
  NetworkEvents,
  PageEventName,
  PageEvents,
  WaitOptions,
} from "./page-events.js";
import type { PageConfig } from "./page-settings.js";

/** Thrown by `PageNetwork.tracker()` when config `network.track` turned tracking off */
class NetworkTrackingDisabledError extends Error {
  constructor() {
    super("network tracking is disabled");
    this.name = "NetworkTrackingDisabledError";
  }
}

/** What `PageNetwork` takes from the page around it */
export interface PageNetworkDeps {
  config: PageConfig;
  tree: TreeSource;
  /** Where `request`, `response` and `requestfailed` are emitted */
  emitter: EventEmitter;
  /** Resolves with the first event of a kind that `matches` accepts (the page's `waitForPageEvent`) */
  waitForEvent: <E extends PageEventName>(
    event: E,
    matches: (item: PageEvents[E][0]) => boolean,
    options: WaitOptions,
    onTimeout: (timeout: number) => Error,
  ) => Promise<PageEvents[E][0]>;
}

/**
 * Everything a page does with its network: request tracking and idle waits, response bodies, waiting for a
 * request or response, the HTTP cache switch and the routes (interception).
 */
export class PageNetwork {
  private lazyTracker = new Lazy<NetworkTracker>();
  private lazyCollector = new Lazy<DataCollector>();
  private lazyRouter = new Lazy<Router>();
  private responses = new WeakMap<NetworkResponse, Response>();

  constructor(
    private connector: BiDiConnector,
    private contextId: BrowsingContext,
    private deps: PageNetworkDeps,
  ) {}

  /** The network tracker, created on first use. Rejects with NetworkTrackingDisabledError when config turned tracking off */
  public tracker(): Promise<NetworkTracker> {
    return this.lazyTracker.get(
      async () => {
        const settings = await this.deps.config.network();
        if ((settings.track ?? DEFAULT_TRACK_NETWORK) === false)
          throw new NetworkTrackingDisabledError();
        const tracker = await NetworkTracker.start(
          this.connector,
          await this.deps.tree.ensure(),
          this.contextId,
        );
        const { emitter } = this.deps;
        tracker.on("request", (request) => emitter.emit("request", request));
        tracker.on("response", (response) =>
          emitter.emit("response", this.responseFor(response)),
        );
        tracker.on("requestfailed", (failed) =>
          emitter.emit("requestfailed", failed),
        );
        if (settings.collectBodies ?? DEFAULT_COLLECT_BODIES)
          await this.startBodyCollection();
        return tracker;
      },
      (err) => err instanceof NetworkTrackingDisabledError,
    );
  }

  /** Starts following requests now; does nothing when config `network.track` is false */
  public async startTracking(): Promise<void> {
    try {
      await this.tracker();
    } catch (err) {
      if (!(err instanceof NetworkTrackingDisabledError)) throw err;
    }
  }

  /** Waits until no request has been in flight for `idleTime` ms (default config `network.idleTime`, then 500) */
  public async waitForIdle(
    options: { idleTime?: number; timeout?: number } = {},
  ): Promise<void> {
    const tracker = await this.tracker();
    const idleTime = await this.deps.config.idleTime(options.idleTime);
    const timeout = await this.deps.config.navigationTimeout(options.timeout);
    await tracker.waitForIdle({ idleTime, timeout });
  }

  /** Starts keeping response bodies, which is what makes `response.body()` possible */
  public async startBodyCollection(): Promise<void> {
    await this.lazyCollector.get(this.openCollector);
  }

  private openCollector = async (): Promise<DataCollector> => {
    const { maxBodySize } = await this.deps.config.network();
    return DataCollector.start(this.connector, this.contextId, {
      ...(maxBodySize !== undefined && { maxBodySize }),
    });
  };

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
    if (!this.lazyCollector.started) {
      throw new ResponseBodyUnavailableError(
        response.url,
        "no body collection was running: call page.startBodyCollection() before the request, or listen with page.on('response')",
      );
    }
    const collector = await this.lazyCollector.get(this.openCollector);
    const body = await collector.read(response.id, response.url);
    void collector.release(response.id);
    return body;
  }

  /** Resolves with the next response whose URL matches (a pattern, see `route`) or that the function accepts */
  public async waitForResponse(
    match: NetworkMatch<Response>,
    options: WaitOptions = {},
  ): Promise<Response> {
    await Promise.all([this.tracker(), this.startBodyCollection()]);
    return this.waitForNetworkEvent("response", match, options);
  }

  /** Like `waitForResponse`, for requests */
  public async waitForRequest(
    match: NetworkMatch<NetworkRequest>,
    options: WaitOptions = {},
  ): Promise<NetworkRequest> {
    await this.tracker();
    return this.waitForNetworkEvent("request", match, options);
  }

  private waitForNetworkEvent<E extends "request" | "response">(
    event: E,
    match: NetworkMatch<NetworkEvents[E][0]>,
    options: WaitOptions,
  ): Promise<NetworkEvents[E][0]> {
    const matches = toPredicate(match as NetworkMatch<{ url: string }>) as (
      item: NetworkEvents[E][0],
    ) => boolean;
    const Timeout =
      event === "request" ? RequestTimeoutError : ResponseTimeoutError;
    return this.deps.waitForEvent(
      event,
      matches,
      options,
      (timeout) =>
        new Timeout(
          event === "request" ? "waitForRequest" : "waitForResponse",
          match as never,
          timeout,
        ),
    );
  }

  /** Turns the browser's HTTP cache off (`true`) or back on for this page: every request then goes to the server */
  public async setCacheDisabled(disabled: boolean): Promise<void> {
    try {
      await this.connector.send("network.setCacheBehavior", {
        cacheBehavior: disabled ? "bypass" : "default",
        contexts: [this.contextId],
      });
    } catch (err) {
      if (isUnsupported(err)) {
        throw new UnsupportedOperationError(
          "setCacheDisabled(): not supported by the browser",
        );
      }
      throw err;
    }
  }

  private router(): Promise<Router> {
    return this.lazyRouter.get(async () => {
      const routeTimeout = (await this.deps.config.network()).routeTimeout;
      return new Router(
        this.connector,
        await this.deps.tree.ensure(),
        this.contextId,
        { ...(routeTimeout !== undefined && { routeTimeout }) },
      );
    });
  }

  /** Sends requests whose URL matches to `handler` (see `Page.route`) */
  public async route(url: UrlPattern, handler: RouteHandler): Promise<void> {
    await (await this.router()).route(url, handler);
  }

  /** Removes the routes for `url` (only the one with `handler`, when given) */
  public async unroute(url: UrlPattern, handler?: RouteHandler): Promise<void> {
    if (!this.lazyRouter.started) return;
    await (await this.router()).unroute(url, handler);
  }

  public async unrouteAll(): Promise<void> {
    if (!this.lazyRouter.started) return;
    await (await this.router()).unrouteAll();
  }

  /** Errors thrown by route handlers so far */
  public routeErrors(): readonly Error[] {
    return this.lazyRouter.peek()?.errors ?? [];
  }

  /** The first half of releasing the network: the tracker goes before the tree it reads */
  public async disposeTracker(): Promise<void> {
    try {
      await (await this.lazyTracker.take())?.dispose();
    } catch {
      // A tracker that never started (or was switched off) has nothing to release
    }
  }

  /** The second half: the router, then the body collector */
  public disposeRest(): (Promise<void> | undefined)[] {
    const router = this.lazyRouter.take();
    const collector = this.lazyCollector.take();
    return [
      router?.then((resolved) => resolved.dispose()),
      collector?.then((resolved) => resolved.dispose()),
    ];
  }
}
