import { STATUS_CODES } from "node:http";
import logger from "../logger/index.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BiDiCommands } from "../types/bidi.js";
import { headersToBidi, toBytes } from "./bidi-wire.js";
import type { NetworkRequest } from "./network-types.js";
import type { UrlPattern } from "./url-match.js";

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

export interface RouteEntry {
  pattern: UrlPattern;
  handler: RouteHandler;
}

/** Answers `network.*` commands for one blocked request */
export interface RouteDeps {
  send: BiDiConnector["send"];
  /** Passes the request to the next matching route, or lets it continue */
  next: () => Promise<void>;
  /** Called once the route is answered, whichever way */
  settled: () => void;
  /**
   * Whether a replaced body needs a `content-length` of its own. Firefox keeps the old one and cuts the new body
   * off; Chrome sets the right one itself and hangs the request when it is given one.
   */
  sendsContentLength: boolean;
}

const hasHeader = (headers: Record<string, string>, name: string) =>
  Object.keys(headers).some((key) => key.toLowerCase() === name);

/**
 * A request the browser holds until it is answered. Answer it exactly once with `fulfill`, `continue`,
 * `abort` or `fallback`; a second call throws.
 */
export class Route {
  private answered = false;

  constructor(
    private readonly info: NetworkRequest,
    private readonly deps: RouteDeps,
  ) {}

  public request(): NetworkRequest {
    return this.info;
  }

  /** Answers the request without sending it: status 200 and no body unless told otherwise */
  public async fulfill(options: FulfillOptions = {}): Promise<void> {
    if (options.json !== undefined && options.body !== undefined) {
      throw new TypeError("fulfill(): use either json or body, not both");
    }
    const text =
      options.json !== undefined ? JSON.stringify(options.json) : undefined;
    const body = options.body ?? text;
    const headers: Record<string, string> = { ...options.headers };
    const contentType =
      options.contentType ??
      (text !== undefined ? "application/json" : undefined);
    if (contentType && !hasHeader(headers, "content-type"))
      headers["content-type"] = contentType;
    if (!hasHeader(headers, "content-length")) {
      headers["content-length"] = String(
        body === undefined ? 0 : Buffer.byteLength(body),
      );
    }
    const status = options.status ?? 200;
    await this.answer("network.provideResponse", {
      request: this.info.id,
      statusCode: status,
      reasonPhrase: STATUS_CODES[status] ?? "",
      headers: headersToBidi(headers),
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
        Object.entries(headers ?? this.info.headers).filter(
          ([name]) => name.toLowerCase() !== "content-length",
        ),
      );
      headers = this.deps.sendsContentLength
        ? {
            ...withoutLength,
            "content-length": String(Buffer.byteLength(options.postData)),
          }
        : withoutLength;
    }
    await this.answer("network.continueRequest", {
      request: this.info.id,
      ...(options.url !== undefined && { url: options.url }),
      ...(options.method !== undefined && { method: options.method }),
      ...(headers !== undefined && { headers: headersToBidi(headers) }),
      ...(options.postData !== undefined && {
        body: toBytes(options.postData),
      }),
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

  private claim() {
    if (this.answered) throw new Error("route already handled");
    this.answered = true;
    this.deps.settled();
  }

  private async answer<
    M extends
      | "network.provideResponse"
      | "network.continueRequest"
      | "network.failRequest",
  >(method: M, params: BiDiCommands[M]["params"]) {
    this.claim();
    await this.deps.send(method, params);
  }
}

/** What a `PendingRoute` needs of the router: how to talk to the browser and where to go on */
export type PendingRouteControl = Omit<RouteDeps, "settled"> & {
  /** Called once the request is answered, whichever way */
  onSettled: (pending: PendingRoute) => void;
};

/**
 * A request the browser holds, with what the router needs to see to it: the `Route` handed to the handler, the
 * route entry that holds it, and the timer that lets it continue when the handler is too slow.
 * Not part of the public API: handlers only ever see the `Route`.
 */
export class PendingRoute {
  public readonly route: Route;
  private answered = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** `entry` is the route that holds the request; none for one nobody asked for */
  constructor(
    private readonly info: NetworkRequest,
    control: PendingRouteControl,
    public readonly entry?: RouteEntry,
  ) {
    this.route = new Route(info, {
      send: control.send,
      next: control.next,
      sendsContentLength: control.sendsContentLength,
      settled: () => {
        this.answered = true;
        clearTimeout(this.timer);
        control.onSettled(this);
      },
    });
  }

  public get isAnswered(): boolean {
    return this.answered;
  }

  /** Calls `onLate` when nothing answered after `ms`; the timer never keeps the process alive */
  public startTimer(ms: number, onLate: () => void): void {
    this.timer = setTimeout(() => {
      if (!this.answered) onLate();
    }, ms);
    this.timer.unref?.();
  }

  /** Lets the request continue unchanged; failures are logged, not thrown */
  public async release(): Promise<void> {
    if (this.answered) return;
    try {
      await this.route.continue();
    } catch (err) {
      logger.debug("Could not let %s continue", this.info.url, { err });
    }
  }

  /** Fails the request; failures are logged, not thrown */
  public async failQuietly(): Promise<void> {
    if (this.answered) return;
    try {
      await this.route.abort();
    } catch (err) {
      logger.debug("Could not fail %s", this.info.url, { err });
    }
  }
}
