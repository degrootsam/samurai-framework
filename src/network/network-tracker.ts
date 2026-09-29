import EventEmitter from "node:events";
import type { ContextTree } from "../browser/context-tree.js";
import logger from "../logger/index.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { Subscription } from "../transport/subscriptions.js";
import type {
  BeforeRequestSentParameters,
  FetchErrorParameters,
  Header,
  RequestData,
  ResponseCompletedParameters,
} from "../types/bidi-modules/network.js";
import { WaitTimeoutError } from "../wait/wait-until.js";

/** How many URLs a timeout message names */
const URLS_IN_MESSAGE = 5;

export interface NetworkRequest {
  /** The browser's id; the same for every hop of a redirect chain */
  id: string;
  url: string;
  method: string;
  /** Header names lower-cased; repeated headers joined with ", " */
  headers: Record<string, string>;
  /** "document", "script", "image", …; falls back to the initiator type, then "other" */
  resourceType: string;
  navigation: string | null;
  /** The request this one is the redirect of, or null */
  redirectedFrom: NetworkRequest | null;
  /** True while a network intercept holds it */
  isBlocked: boolean;
}

export interface NetworkResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  fromCache: boolean;
  request: NetworkRequest;
}

export type FailedRequest = NetworkRequest & { errorText: string };

interface EventMap {
  request: [NetworkRequest];
  response: [NetworkResponse];
  requestfailed: [FailedRequest];
}
export type NetworkEventName = keyof EventMap;

export interface TrackerOptions {
  /** Requests it returns true for are neither counted nor emitted. Default: none */
  ignore?: (request: NetworkRequest) => boolean;
}

/** waitForIdle ran out of time with requests still in flight; `last` holds (up to five of) their URLs */
export class NetworkIdleTimeoutError extends WaitTimeoutError<string[]> {
  constructor(timeout: number, inflight: number, urls: string[]) {
    super(timeout, urls);
    this.name = "NetworkIdleTimeoutError";
    this.message = `waitForNetworkIdle(): still ${inflight} request(s) in flight after ${timeout}ms: ${urls.join(", ")}`;
  }
}

interface Waiter {
  reject: (reason: unknown) => void;
}

/**
 * Follows the network activity of one page (its frames included): which requests are in flight,
 * and `request` / `response` / `requestfailed` events. In-flight is keyed by `request id:redirect count`,
 * so a redirect chain is one live request at a time.
 */
export class NetworkTracker {
  private events = new EventEmitter();
  private active = new Map<string, string>();
  /** Requests that may still be the source of a redirect, by hop key */
  private hops = new Map<string, NetworkRequest>();
  private waiters = new Set<Waiter>();
  private disposed = false;

  private constructor(
    private tree: ContextTree,
    private contextId: string,
    private ignore: (request: NetworkRequest) => boolean,
    private connector: BiDiConnector,
  ) {}

  public static async start(
    connector: BiDiConnector,
    tree: ContextTree,
    contextId: string,
    options: TrackerOptions = {},
  ): Promise<NetworkTracker> {
    const tracker = new NetworkTracker(tree, contextId, options.ignore ?? (() => false), connector);
    // Listen first, then subscribe: nothing can arrive in between
    connector.onEvent("network.beforeRequestSent", tracker.onBeforeRequestSent);
    connector.onEvent("network.responseCompleted", tracker.onResponseCompleted);
    connector.onEvent("network.fetchError", tracker.onFetchError);
    try {
      tracker.subscription = await connector.subscribe([
        "network.beforeRequestSent",
        "network.responseCompleted",
        "network.fetchError",
      ]);
    } catch (err) {
      tracker.removeListeners();
      throw err;
    }
    return tracker;
  }

  private subscription: Subscription | undefined;

  /** Requests currently in flight */
  public get inflight(): number {
    return this.active.size;
  }

  /** URLs of the requests currently in flight, oldest first */
  public get inflightUrls(): string[] {
    return [...this.active.values()];
  }

  /** Waits that have not finished yet */
  public get waiting(): number {
    return this.waiters.size;
  }

  public on<E extends NetworkEventName>(event: E, listener: (...args: EventMap[E]) => void): void {
    this.events.on(event, listener as (...args: unknown[]) => void);
  }

  public off<E extends NetworkEventName>(event: E, listener: (...args: EventMap[E]) => void): void {
    this.events.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Resolves once no request has been in flight for `idleTime` ms. A quiet page resolves after `idleTime`.
   * Rejects with NetworkIdleTimeoutError after `timeout` ms, or with "page closed" when disposed.
   */
  public waitForIdle({ idleTime, timeout }: { idleTime: number; timeout: number }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const waiter: Waiter = { reject: (reason) => finish(() => reject(reason)) };
      const finish = (settle: () => void) => {
        clearTimeout(idleTimer);
        clearTimeout(deadline);
        this.events.off("change", check);
        this.waiters.delete(waiter);
        settle();
      };
      const check = () => {
        clearTimeout(idleTimer);
        if (this.active.size === 0) idleTimer = setTimeout(() => finish(resolve), idleTime);
      };
      const deadline = setTimeout(
        () =>
          finish(() =>
            reject(
              new NetworkIdleTimeoutError(
                timeout,
                this.active.size,
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
    this.active.clear();
    this.hops.clear();
    [...this.waiters].forEach((waiter) => waiter.reject(new Error("page closed")));
    await this.subscription?.unsubscribe();
  }

  private removeListeners() {
    this.connector.offEvent("network.beforeRequestSent", this.onBeforeRequestSent);
    this.connector.offEvent("network.responseCompleted", this.onResponseCompleted);
    this.connector.offEvent("network.fetchError", this.onFetchError);
  }

  private owns(context: string | null): boolean {
    return context !== null && this.tree.isWithin(context, this.contextId);
  }

  private static key(data: RequestData, redirectCount: number | Number): string {
    return `${data.request}:${Number(redirectCount)}`;
  }

  private onBeforeRequestSent = (params: BeforeRequestSentParameters) => {
    if (!this.owns(params.context)) return;
    const key = NetworkTracker.key(params.request, params.redirectCount);
    const redirectCount = Number(params.redirectCount);
    const previousKey = `${params.request.request}:${redirectCount - 1}`;
    const redirectedFrom = redirectCount > 0 ? (this.hops.get(previousKey) ?? null) : null;
    this.hops.delete(previousKey);

    const request = toRequest(params.request, params.navigation, params.isBlocked, redirectedFrom);
    if (this.ignore(request)) return;
    this.hops.set(key, request);
    this.active.set(key, request.url);
    this.emit("request", request);
    this.events.emit("change");
  };

  private onResponseCompleted = (params: ResponseCompletedParameters) => {
    if (!this.owns(params.context)) return;
    const key = NetworkTracker.key(params.request, params.redirectCount);
    const request = this.hops.get(key);
    if (!this.active.delete(key) || !request) return;
    const { response } = params;
    // A redirect response keeps its request around: the next hop links back to it
    if (response.status < 300 || response.status >= 400) this.hops.delete(key);
    this.emit("response", {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      headers: toHeaders(response.headers),
      fromCache: response.fromCache,
      request,
    });
    this.events.emit("change");
  };

  private onFetchError = (params: FetchErrorParameters) => {
    if (!this.owns(params.context)) return;
    const key = NetworkTracker.key(params.request, params.redirectCount);
    const request = this.hops.get(key);
    if (!this.active.delete(key) || !request) return;
    this.hops.delete(key);
    this.emit("requestfailed", Object.assign(request, { errorText: params.errorText }));
    this.events.emit("change");
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

export function toRequest(
  data: RequestData,
  navigation: string | null,
  isBlocked: boolean,
  redirectedFrom: NetworkRequest | null,
): NetworkRequest {
  return {
    id: data.request,
    url: data.url,
    method: data.method,
    headers: toHeaders(data.headers),
    resourceType: data.destination || data.initiatorType || "other",
    navigation,
    redirectedFrom,
    isBlocked,
  };
}

/** Header list to a lower-cased record; repeated names are joined, base64 values decoded */
export function toHeaders(headers: Header[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { name, value } of headers) {
    const text = value.type === "base64" ? Buffer.from(value.value, "base64").toString("utf8") : value.value;
    const key = name.toLowerCase();
    result[key] = key in result ? `${result[key]}, ${text}` : text;
  }
  return result;
}
