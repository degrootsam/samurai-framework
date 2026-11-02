import EventEmitter from "node:events";
import type { ContextTree } from "../browser/context-tree.js";
import logger from "../logger/index.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { Subscription } from "../transport/subscriptions.js";
import type {
  BaseParameters,
  BeforeRequestSentParameters,
  FetchErrorParameters,
  RequestData,
  ResponseCompletedParameters,
  ResponseData,
} from "../types/bidi-modules/network.js";
import { headersFromBidi, toRequest } from "./bidi-wire.js";
import { NetworkIdleTimeoutError } from "./network-wait.js";
import {
  type EventMap,
  type NetworkEventName,
  type NetworkRequest,
} from "./network-types.js";

export type {
  FailedRequest,
  NetworkEventName,
  NetworkRequest,
  NetworkResponse,
} from "./network-types.js";
export { NetworkIdleTimeoutError } from "./network-wait.js";

/** The error text of a request that the page left before it finished, when the browser says none */
const ABORTED_BY_NAVIGATION = "aborted by navigation";

/** How many URLs a timeout message names */
const URLS_IN_MESSAGE = 5;

export interface TrackerOptions {
  /** Requests it returns true for are neither counted nor emitted. Default: none */
  ignore?: (request: NetworkRequest) => boolean;
}

/** One hop of a request. `answered`: its (redirect) response is in, and it stays live until the next hop shows */
interface Hop {
  request: NetworkRequest;
  context: string;
  live: boolean;
  answered: boolean;
}

/**
 * Follows the network activity of one page (its frames included): which requests are in flight,
 * and `request` / `response` / `requestfailed` events. In-flight is keyed by `request id:redirect count`,
 * so a redirect chain is one live request at a time.
 *
 * Chrome (chromium-bidi) reports a redirect response only once the browser has started the next hop, and it can
 * leave out that hop's `beforeRequestSent`: when the hop's `requestWillBeSentExtraInfo` reaches it before the
 * redirect's `requestWillBeSent`, it files the extra info under the previous hop and never announces the new one.
 * So on Chrome a redirect keeps the chain in flight until the next hop shows itself, and a hop that first shows up
 * with its response or error is announced then.
 */
export class NetworkTracker {
  private events = new EventEmitter();
  private subscription: Subscription | undefined;
  /**
   * Every hop that is in flight or may still be the source of a redirect, by hop key. A redirect response ends a
   * hop's flight (`live` false; on Chrome `answered`, live until the next hop shows) but keeps it, for the next
   * hop's `redirectedFrom`.
   */
  private hops = new Map<string, Hop>();
  /** Rejects a pending `waitForIdle`; each wait adds its own */
  private waiters = new Set<(reason: unknown) => void>();
  private disposed = false;

  private constructor(
    private tree: ContextTree,
    private contextId: string,
    private ignore: (request: NetworkRequest) => boolean,
    private connector: BiDiConnector,
  ) {}

  /** Whether a redirect response means the next hop has already started (Chrome), see the class comment */
  private get redirectsStartNextHop(): boolean {
    return this.connector.browserName === "chrome";
  }

  public static async start(
    connector: BiDiConnector,
    tree: ContextTree,
    contextId: string,
    options: TrackerOptions = {},
  ): Promise<NetworkTracker> {
    const tracker = new NetworkTracker(
      tree,
      contextId,
      options.ignore ?? (() => false),
      connector,
    );
    // Listen first, then subscribe: nothing can arrive in between
    connector.onEvent("network.beforeRequestSent", tracker.onBeforeRequestSent);
    connector.onEvent("network.responseCompleted", tracker.onResponseCompleted);
    connector.onEvent("network.fetchError", tracker.onFetchError);
    connector.onEvent(
      "browsingContext.navigationCommitted",
      tracker.onNavigationCommitted,
    );
    try {
      tracker.subscription = await connector.subscribe([
        "network.beforeRequestSent",
        "network.responseCompleted",
        "network.fetchError",
        "browsingContext.navigationCommitted",
      ]);
    } catch (err) {
      tracker.removeListeners();
      throw err;
    }
    return tracker;
  }

  /** Requests currently in flight */
  public get inflight(): number {
    return this.liveHops().length;
  }

  /** URLs of the requests currently in flight, oldest first */
  public get inflightUrls(): string[] {
    return this.liveHops().map(({ request }) => request.url);
  }

  private liveHops() {
    return [...this.hops.values()].filter(({ live }) => live);
  }

  /** Waits that have not finished yet */
  public get waiting(): number {
    return this.waiters.size;
  }

  public on<E extends NetworkEventName>(
    event: E,
    listener: (...args: EventMap[E]) => void,
  ): void {
    this.events.on(event, listener as (...args: unknown[]) => void);
  }

  public off<E extends NetworkEventName>(
    event: E,
    listener: (...args: EventMap[E]) => void,
  ): void {
    this.events.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Resolves once no request has been in flight for `idleTime` ms. A quiet page resolves after `idleTime`.
   * Rejects with NetworkIdleTimeoutError after `timeout` ms, or with "page closed" when disposed.
   */
  public waitForIdle({
    idleTime,
    timeout,
  }: {
    idleTime: number;
    timeout: number;
  }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const waiter = (reason: unknown) => finish(() => reject(reason));
      const finish = (settle: () => void) => {
        clearTimeout(idleTimer);
        clearTimeout(deadline);
        this.events.off("change", check);
        this.waiters.delete(waiter);
        settle();
      };
      const check = () => {
        clearTimeout(idleTimer);
        if (this.inflight === 0)
          idleTimer = setTimeout(() => finish(resolve), idleTime);
      };
      const deadline = setTimeout(
        () =>
          finish(() =>
            reject(
              new NetworkIdleTimeoutError(
                timeout,
                this.inflight,
                this.inflightUrls.slice(0, URLS_IN_MESSAGE),
              ),
            ),
          ),
        timeout,
      );
      this.waiters.add(waiter);
      this.events.on("change", check);
      check();
    });
  }

  /** Stops tracking, unsubscribes and rejects pending waits. Idempotent */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.removeListeners();
    this.hops.clear();
    [...this.waiters].forEach((reject) => reject(new Error("page closed")));
    await this.subscription?.unsubscribe();
  }

  private removeListeners() {
    this.connector.offEvent(
      "network.beforeRequestSent",
      this.onBeforeRequestSent,
    );
    this.connector.offEvent(
      "network.responseCompleted",
      this.onResponseCompleted,
    );
    this.connector.offEvent("network.fetchError", this.onFetchError);
    this.connector.offEvent(
      "browsingContext.navigationCommitted",
      this.onNavigationCommitted,
    );
  }

  private owns(context: string | null): boolean {
    return context !== null && this.tree.isWithin(context, this.contextId);
  }

  private static key(data: RequestData, redirectCount: number): string {
    return `${data.request}:${redirectCount}`;
  }

  private onBeforeRequestSent = (params: BeforeRequestSentParameters) => {
    if (!this.owns(params.context)) return;
    this.startHop(params);
  };

  /** Tracks a new hop and emits its `request`; the hop it was redirected from is done with */
  private startHop(params: BaseParameters): Hop | undefined {
    const key = NetworkTracker.key(params.request, params.redirectCount);
    const { redirectCount } = params;
    const previousKey = `${params.request.request}:${redirectCount - 1}`;
    const previous = redirectCount > 0 ? this.hops.get(previousKey) : undefined;
    this.hops.delete(previousKey);

    const request = toRequest(
      params.request,
      params.navigation,
      params.isBlocked,
      previous?.request ?? null,
    );
    if (this.ignore(request)) {
      if (previous?.live) this.events.emit("change");
      return undefined;
    }
    const hop = {
      request,
      context: params.context!,
      live: true,
      answered: false,
    };
    this.hops.set(key, hop);
    this.emit("request", request);
    this.events.emit("change");
    return hop;
  }

  /**
   * The hop a response or error is for. A hop Chrome never announced (see the class comment) is started here,
   * when the hop it was redirected from is known.
   */
  private hopOf(params: BaseParameters): Hop | undefined {
    const hop = this.hops.get(
      NetworkTracker.key(params.request, params.redirectCount),
    );
    if (hop || params.redirectCount === 0) return hop;
    const previousKey = `${params.request.request}:${params.redirectCount - 1}`;
    return this.hops.has(previousKey) ? this.startHop(params) : undefined;
  }

  private onResponseCompleted = (params: ResponseCompletedParameters) => {
    if (!this.owns(params.context)) return;
    const key = NetworkTracker.key(params.request, params.redirectCount);
    const hop = this.hopOf(params);
    if (!hop?.live || hop.answered) return;
    const { request } = hop;
    const { response } = params;
    // A redirect response keeps its request around: the next hop links back to it
    if (response.status < 300 || response.status >= 400) this.hops.delete(key);
    else if (this.redirectsStartNextHop && hasLocation(response))
      hop.answered = true;
    else hop.live = false;
    this.emit("response", {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      headers: headersFromBidi(response.headers),
      fromCache: response.fromCache,
      request,
    });
    this.events.emit("change");
  };

  private onFetchError = (params: FetchErrorParameters) => {
    if (!this.owns(params.context)) return;
    const key = NetworkTracker.key(params.request, params.redirectCount);
    const hop = this.hopOf(params);
    if (!hop?.live) return;
    this.hops.delete(key);
    // A hop that has its response already did not fail
    if (!hop.answered)
      this.emit(
        "requestfailed",
        Object.assign(hop.request, { errorText: params.errorText }),
      );
    this.events.emit("change");
  };

  /**
   * A document replaced another: the requests of the old one that are still in flight are over. Firefox reports each
   * as failed (NS_BINDING_ABORTED); Chrome says nothing, which would keep the page "busy" for good.
   */
  private onNavigationCommitted = (params: {
    context: string;
    navigation: string | null;
  }) => {
    if (!this.owns(params.context)) return;
    let changed = false;
    for (const [key, { request, context, live, answered }] of [...this.hops]) {
      if (!live || request.navigation === params.navigation) continue;
      if (!this.tree.isWithin(context, params.context)) continue;
      this.hops.delete(key);
      if (!answered)
        this.emit(
          "requestfailed",
          Object.assign(request, { errorText: ABORTED_BY_NAVIGATION }),
        );
      changed = true;
    }
    if (changed) this.events.emit("change");
  };

  /** A listener that throws must not stop the tracker or the other listeners */
  private emit<E extends NetworkEventName>(event: E, ...args: EventMap[E]) {
    for (const listener of this.events.listeners(event)) {
      try {
        listener(...args);
      } catch (err) {
        logger.error("A network %s listener threw", event, { err });
      }
    }
  }
}

/** Whether a 3xx response says where to go next: only then does the browser follow it */
function hasLocation(response: ResponseData): boolean {
  return response.headers.some(
    (header) => header.name.toLowerCase() === "location",
  );
}
