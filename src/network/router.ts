import { STATUS_CODES } from "node:http";
import type { ContextTree } from "../browser/context-tree.js";
import logger from "../logger/index.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { Subscription } from "../transport/subscriptions.js";
import type {
  BeforeRequestSentParameters,
  BytesValue,
  Header,
  UrlPattern as BiDiUrlPattern,
} from "../types/bidi-modules/network.js";
import { toRequest, type NetworkRequest } from "./network-tracker.js";
import { isExactString, matchUrl, samePattern, type UrlPattern } from "./url-match.js";

/** Time (ms) a handler may take to answer a request before the router lets it continue */
const DEFAULT_ROUTE_TIMEOUT = 30000;
/** How many handler errors the router keeps */
const MAX_ERRORS = 100;

export type RouteHandler = (route: Route) => void | Promise<void>;

export interface FulfillOptions {
  /** @default 200 */
  status?: number;
  headers?: Record<string, string>;
  /** Sets `content-type` unless `headers` has one; `json` implies "application/json" */
  contentType?: string;
  body?: string | Buffer;
  /** Sent as JSON text; cannot be combined with `body` */
  json?: unknown;
}

export interface ContinueOptions {
  /**
   * Sends the request to another URL. Firefox applies this to navigations only: the page's `fetch`, XHR and
   * image requests fail when their URL is changed, so mock those with `fulfill` instead
   */
  url?: string;
  method?: string;
  /** Replaces all request headers */
  headers?: Record<string, string>;
  postData?: string | Buffer;
}

interface RouteEntry {
  pattern: UrlPattern;
  handler: RouteHandler;
}

/** Answers `network.*` commands for one blocked request */
interface RouteDeps {
  send: BiDiConnector["send"];
  /** Passes the request to the next matching route, or lets it continue */
  next: () => Promise<void>;
  /** Called once the route is answered, whichever way */
  settled: (route: Route) => void;
}

function toHeaders(headers: Record<string, string>): Header[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value: { type: "string", value } }));
}

function toBytes(data: string | Buffer): BytesValue {
  return typeof data === "string"
    ? { type: "string", value: data }
    : { type: "base64", value: data.toString("base64") };
}

const hasHeader = (headers: Record<string, string>, name: string) =>
  Object.keys(headers).some((key) => key.toLowerCase() === name);

/**
 * A request the browser holds until it is answered. Answer it exactly once with `fulfill`, `continue`,
 * `abort` or `fallback`; a second call throws.
 */
export class Route {
  private answered = false;
  /** @internal */
  public timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly info: NetworkRequest,
    /** @internal */
    public readonly entry: RouteEntry,
    private readonly deps: RouteDeps,
  ) {}

  public request(): NetworkRequest {
    return this.info;
  }

  /** @internal */
  public get isAnswered(): boolean {
    return this.answered;
  }

  /** Answers the request without sending it: status 200 and no body unless told otherwise */
  public async fulfill(options: FulfillOptions = {}): Promise<void> {
    if (options.json !== undefined && options.body !== undefined) {
      throw new TypeError("route.fulfill(): use either json or body, not both");
    }
    const text = options.json !== undefined ? JSON.stringify(options.json) : undefined;
    const body = options.body ?? text;
    const headers: Record<string, string> = { ...options.headers };
    const contentType = options.contentType ?? (text !== undefined ? "application/json" : undefined);
    if (contentType && !hasHeader(headers, "content-type")) headers["content-type"] = contentType;
    if (!hasHeader(headers, "content-length")) {
      headers["content-length"] = String(body === undefined ? 0 : Buffer.byteLength(body));
    }
    const status = options.status ?? 200;
    await this.answer("network.provideResponse", {
      request: this.info.id,
      statusCode: status,
      reasonPhrase: STATUS_CODES[status] ?? "",
      headers: toHeaders(headers),
      ...(body !== undefined && { body: toBytes(body) }),
    });
  }

  /**
   * Lets the request go on, optionally changed. `headers` replaces all request headers. A new `postData` brings its
   * own `content-length` (the request's old one would cut the new body off or leave the server waiting).
   */
  public async continue(options: ContinueOptions = {}): Promise<void> {
    let headers = options.headers;
    if (options.postData !== undefined) {
      const withoutLength = Object.fromEntries(
        Object.entries(headers ?? this.info.headers).filter(([name]) => name.toLowerCase() !== "content-length"),
      );
      headers = { ...withoutLength, "content-length": String(Buffer.byteLength(options.postData)) };
    }
    await this.answer("network.continueRequest", {
      request: this.info.id,
      ...(options.url !== undefined && { url: options.url }),
      ...(options.method !== undefined && { method: options.method }),
      ...(headers !== undefined && { headers: toHeaders(headers) }),
      ...(options.postData !== undefined && { body: toBytes(options.postData) }),
    });
  }

  /** Makes the request fail (the browser reports a network error to the page) */
  public async abort(): Promise<void> {
    await this.answer("network.failRequest", { request: this.info.id });
  }

  /** Hands the request to the next route that matches it, or lets it continue when there is none */
  public async fallback(): Promise<void> {
    this.claim();
    await this.deps.next();
  }

  /** @internal Lets the request continue unchanged; failures are logged, not thrown */
  public async release(): Promise<void> {
    if (this.answered) return;
    try {
      await this.continue();
    } catch (err) {
      logger.debug("Could not let %s continue", this.info.url, { err });
    }
  }

  /** @internal Fails the request; failures are logged, not thrown */
  public async failQuietly(): Promise<void> {
    if (this.answered) return;
    try {
      await this.abort();
    } catch (err) {
      logger.debug("Could not fail %s", this.info.url, { err });
    }
  }

  private claim() {
    if (this.answered) throw new Error("route already handled");
    this.answered = true;
    clearTimeout(this.timer);
    this.deps.settled(this);
  }

  private async answer<M extends "network.provideResponse" | "network.continueRequest" | "network.failRequest">(
    method: M,
    params: Parameters<BiDiConnector["send"]>[1],
  ) {
    this.claim();
    await this.deps.send(method, params as never);
  }
}

/** Whether a browser accepts `urlPatterns` in `network.addIntercept`; asked once per connection */
const patternsUnsupported = new WeakSet<BiDiConnector>();

/**
 * Lets a page mock, block and change requests. One `network.addIntercept` serves all routes; matching
 * happens here. Every request the browser holds is answered exactly once, so nothing hangs.
 */
export class Router {
  private routes: RouteEntry[] = [];
  private pending = new Set<Route>();
  private failures: Error[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private interceptIds = new Set<string>();
  private currentKey: string | undefined;
  private currentId: string | undefined;
  private subscription: Subscription | undefined;
  private disposed = false;
  private routeTimeout: number;

  constructor(
    private connector: BiDiConnector,
    private tree: ContextTree,
    private contextId: string,
    options: { routeTimeout?: number } = {},
  ) {
    this.routeTimeout = options.routeTimeout ?? DEFAULT_ROUTE_TIMEOUT;
  }

  /** Errors thrown by route handlers, oldest first */
  public get errors(): readonly Error[] {
    return [...this.failures];
  }

  /** Sends matching requests to `handler`. Later routes are asked first */
  public async route(pattern: UrlPattern, handler: RouteHandler): Promise<void> {
    if (this.disposed) throw new Error("router disposed");
    const entry: RouteEntry = { pattern, handler };
    this.routes.push(entry);
    try {
      await this.enqueue(() => this.sync());
    } catch (err) {
      this.routes = this.routes.filter((route) => route !== entry);
      throw err;
    }
  }

  /** Removes the routes for `pattern` (only the one with `handler`, when given) */
  public async unroute(pattern: UrlPattern, handler?: RouteHandler): Promise<void> {
    const removed = this.routes.filter(
      (route) => samePattern(route.pattern, pattern) && (handler === undefined || route.handler === handler),
    );
    await this.remove(removed);
  }

  public async unrouteAll(): Promise<void> {
    await this.remove([...this.routes]);
  }

  /** Lets held requests continue, removes the intercept and stops listening. Idempotent */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.remove([...this.routes]);
  }

  private async remove(removed: RouteEntry[]) {
    if (removed.length === 0) return;
    this.routes = this.routes.filter((route) => !removed.includes(route));
    // Requests a removed route still holds would wait for nobody
    await Promise.all([...this.pending].filter((route) => removed.includes(route.entry)).map((route) => route.release()));
    await this.enqueue(() => this.sync());
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Makes the browser-side intercept match the routes: none, one for everything, or one for exact URLs */
  private async sync(): Promise<void> {
    if (this.routes.length === 0) return this.stop();

    await this.listen();
    const patterns = this.urlPatterns();
    const key = patterns ? JSON.stringify(patterns) : "all";
    if (key === this.currentKey) return;

    const id = await this.addIntercept(patterns);
    const previous = this.currentId;
    this.currentId = id;
    this.currentKey = patterns && !patternsUnsupported.has(this.connector) ? key : "all";
    this.interceptIds.add(id);
    // The new intercept is in place before the old one goes: nothing slips through in between
    if (previous !== undefined) await this.removeIntercept(previous);
  }

  /** The exact URLs to block, or undefined to block everything and match here */
  private urlPatterns(): BiDiUrlPattern[] | undefined {
    if (patternsUnsupported.has(this.connector)) return undefined;
    const patterns: BiDiUrlPattern[] = [];
    for (const { pattern } of this.routes) {
      // The browser reads a URL string in normal form; anything else could mean something else to it
      if (!isExactString(pattern) || !isNormalUrl(pattern)) return undefined;
      if (!patterns.some((existing) => existing.type === "string" && existing.pattern === pattern)) {
        patterns.push({ type: "string", pattern });
      }
    }
    return patterns;
  }

  private async addIntercept(patterns: BiDiUrlPattern[] | undefined): Promise<string> {
    const params = {
      phases: ["beforeRequestSent" as const],
      contexts: [this.contextId],
    };
    try {
      const { intercept } = await this.connector.send("network.addIntercept", {
        ...params,
        ...(patterns && { urlPatterns: patterns }),
      });
      return intercept;
    } catch (err) {
      if (patterns && err instanceof BiDiError && err.code === "invalid argument") {
        patternsUnsupported.add(this.connector);
        return this.addIntercept(undefined);
      }
      throw err;
    }
  }

  private async removeIntercept(id: string): Promise<void> {
    try {
      await this.connector.send("network.removeIntercept", { intercept: id });
    } catch (err) {
      if (!(err instanceof BiDiError && err.code === "no such intercept")) throw err;
    } finally {
      this.interceptIds.delete(id);
    }
  }

  private async listen(): Promise<void> {
    if (this.subscription) return;
    this.connector.onEvent("network.beforeRequestSent", this.onBeforeRequestSent);
    try {
      this.subscription = await this.connector.subscribe(["network.beforeRequestSent"]);
    } catch (err) {
      this.connector.offEvent("network.beforeRequestSent", this.onBeforeRequestSent);
      throw err;
    }
  }

  private async stop(): Promise<void> {
    const id = this.currentId;
    this.currentId = undefined;
    this.currentKey = undefined;
    if (id !== undefined) await this.removeIntercept(id);
    if (this.subscription) {
      this.connector.offEvent("network.beforeRequestSent", this.onBeforeRequestSent);
      const subscription = this.subscription;
      this.subscription = undefined;
      await subscription.unsubscribe();
    }
  }

  private onBeforeRequestSent = (params: BeforeRequestSentParameters) => {
    if (!params.isBlocked || params.context === null) return;
    if (!this.tree.isWithin(params.context, this.contextId)) return;
    // Held by an intercept of ours, not someone else's
    if (!(params.intercepts ?? []).some((id) => this.interceptIds.has(id))) return;

    const info = toRequest(params.request, params.navigation, params.isBlocked, null);
    const matching = this.routes.filter((entry) => matchUrl(entry.pattern, info.url)).reverse();
    this.dispatch(info, matching, 0).catch((err) =>
      logger.error("Handling the request to %s failed", info.url, { err }),
    );
  };

  /** Runs the `index`-th matching route; past the last one the request continues unchanged */
  private async dispatch(info: NetworkRequest, matching: RouteEntry[], index: number): Promise<void> {
    const entry = matching[index];
    const deps: RouteDeps = {
      send: (method, params) => this.connector.send(method, params),
      next: () => this.dispatch(info, matching, index + 1),
      settled: (settled) => {
        this.pending.delete(settled);
      },
    };
    if (!entry) {
      // Nobody (left) to ask: an unmatched request, or every route fell back
      await new Route(info, { pattern: "", handler: () => {} }, deps).release();
      return;
    }

    const route = new Route(info, entry, deps);
    this.pending.add(route);
    route.timer = setTimeout(() => {
      if (route.isAnswered) return;
      logger.error("A route for %s did not answer within %dms; letting the request continue", info.url, this.routeTimeout);
      void route.release();
    }, this.routeTimeout);
    route.timer.unref?.();

    try {
      await entry.handler(route);
    } catch (err) {
      this.record(info, err);
      await route.failQuietly();
      return;
    }
    if (!route.isAnswered) {
      logger.warn("The route for %s did not answer the request; letting it continue", info.url);
      await route.release();
    }
  }

  private record(info: NetworkRequest, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const error = Object.assign(new Error(`route handler for ${info.url} threw: ${message}`), { cause: err });
    this.failures.push(error);
    if (this.failures.length > MAX_ERRORS) this.failures.shift();
    logger.error("A route handler threw for %s", info.url, { err });
  }
}

function isNormalUrl(value: string): boolean {
  try {
    return new URL(value).href === value;
  } catch {
    return false;
  }
}
