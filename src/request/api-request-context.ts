import { RELATIVE_URL } from "../config/base-url.js";
import { peekRunSettings } from "../config/run-settings.js";
import { APIResponse } from "./api-response.js";
import type { CookieStore } from "./cookie-jar.js";
import { sendHop, TransportError, describeURL } from "./http-transport.js";
import { encodeBody, type BodyOptions } from "./request-body.js";
import { followUp, redirectTarget } from "./redirect.js";
import type { StorageState } from "../types/use.js";

/** Milliseconds a request may take, redirects included */
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_REDIRECTS = 20;

/** Options of one request */
export interface RequestOptions extends BodyOptions {
  /** Only for `fetch`. @default "GET" */
  method?: string;
  /** Added to the context's `extraHTTPHeaders`; a name set in both takes this value */
  headers?: Record<string, string>;
  /** Query parameters, added to the ones the URL has */
  params?: Record<string, string | number | boolean> | URLSearchParams | string;
  /** Milliseconds for the whole request, redirects included; 0 for no limit. @default 30000 */
  timeout?: number;
  /** Throw for a status outside 200 to 299 instead of returning the response */
  failOnStatusCode?: boolean;
  /** Accept certificates that are self-signed, expired or for another host. @default the context's setting */
  ignoreHTTPSErrors?: boolean;
  /** Redirects to follow; 0 returns the 3xx response itself. @default 20 */
  maxRedirects?: number;
  /** Times to send the request again when the connection is reset before an answer. @default 0 */
  maxRetries?: number;
}

/** What a context starts from; `BrowserContext.request` hands its own object and changes it as the run's `use` options arrive */
export interface RequestContextOptions {
  /** Relative request URLs resolve against it. @default the run's baseURL */
  baseURL?: string | undefined;
  /** Headers added to every request */
  extraHTTPHeaders?: Record<string, string> | undefined;
  /** Accept certificates that are self-signed, expired or for another host */
  ignoreHTTPSErrors?: boolean | undefined;
}

/** A request given to `fetch` instead of a URL: anything with a `url` (such as a request the page made) */
export interface RequestLike {
  url: string;
  method?: string;
}

const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;

/**
 * Makes HTTP requests from the test, outside the browser: log in, set data up, check an API. Cookies come from
 * its `CookieStore`: the browser context's cookies (`page.request`, `context.request`) or its own jar.
 */
export class APIRequestContext {
  private readonly pending = new Set<AbortController>();
  private disposed = false;

  constructor(
    private readonly options: RequestContextOptions,
    private readonly cookies: CookieStore,
  ) {}

  public get(url: string, options?: RequestOptions) {
    return this.fetch(url, { ...options, method: "GET" });
  }

  public post(url: string, options?: RequestOptions) {
    return this.fetch(url, { ...options, method: "POST" });
  }

  public put(url: string, options?: RequestOptions) {
    return this.fetch(url, { ...options, method: "PUT" });
  }

  public patch(url: string, options?: RequestOptions) {
    return this.fetch(url, { ...options, method: "PATCH" });
  }

  public delete(url: string, options?: RequestOptions) {
    return this.fetch(url, { ...options, method: "DELETE" });
  }

  public head(url: string, options?: RequestOptions) {
    return this.fetch(url, { ...options, method: "HEAD" });
  }

  /** Sends a request with any method and returns its response (redirects followed unless `maxRedirects` is 0) */
  public async fetch(
    urlOrRequest: string | URL | RequestLike,
    options: RequestOptions = {},
  ): Promise<APIResponse> {
    if (this.disposed) throw new Error("request context disposed");
    const given =
      typeof urlOrRequest === "string" || urlOrRequest instanceof URL
        ? { url: String(urlOrRequest) }
        : urlOrRequest;
    const method = (options.method ?? given.method ?? "GET").toUpperCase();
    const url = this.urlOf(given.url, options.params);
    const encoded = encodeBody(options);
    const headers = this.headersOf(options.headers);
    if (encoded && !("content-type" in headers))
      headers["content-type"] = encoded.contentType;

    const abort = new AbortController();
    this.pending.add(abort);
    try {
      return await this.send({
        url,
        method,
        headers,
        body: encoded?.body,
        options,
        abort,
      });
    } finally {
      this.pending.delete(abort);
    }
  }

  /** The cookies this context holds, as a `storageState` file lists them (it has no local storage) */
  public async storageState(): Promise<StorageState> {
    return { cookies: await this.cookies.list(), origins: [] };
  }

  /** Stops the requests in flight; the context sends no more */
  public dispose(): Promise<void> {
    this.disposed = true;
    for (const abort of this.pending) abort.abort();
    this.pending.clear();
    return Promise.resolve();
  }

  private async send(plan: {
    url: URL;
    method: string;
    headers: Record<string, string>;
    body: Buffer | undefined;
    options: RequestOptions;
    abort: AbortController;
  }): Promise<APIResponse> {
    const { options, abort } = plan;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const deadline = timeout > 0 ? Date.now() + timeout : 0;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    let { url, method, headers, body } = plan;
    for (let hops = 0; ; hops++) {
      const sent = { ...headers };
      const cookie = await this.cookies.cookieHeader(url);
      if (cookie)
        sent.cookie = sent.cookie ? `${sent.cookie}; ${cookie}` : cookie;
      const remaining = deadline > 0 ? Math.max(1, deadline - Date.now()) : 0;
      const hop = await this.hop(
        { url, method, headers: sent, body },
        options,
        remaining,
        abort.signal,
      );
      if (hop.setCookies.length > 0)
        await this.cookies.store(url, hop.setCookies);
      const location = hop.headers.find(
        (h) => h.name.toLowerCase() === "location",
      )?.value;
      const next = redirectTarget(hop.status, location, url);
      if (next && maxRedirects > 0) {
        if (hops >= maxRedirects)
          throw new Error(
            `fetch(): too many redirects, more than ${maxRedirects} (${method} ${describeURL(plan.url)})`,
          );
        const change = followUp(hop.status, method, body);
        if (change.body === undefined && body !== undefined)
          headers = withoutBody(headers);
        if (next.origin !== url.origin) delete headers.authorization;
        ({ method, body } = change);
        url = next;
        continue;
      }
      const response = new APIResponse({
        url: url.href,
        status: hop.status,
        statusText: hop.statusText,
        headers: hop.headers,
        body: hop.body,
      });
      if (options.failOnStatusCode && !response.ok())
        throw new Error(
          `fetch(): ${hop.status} ${hop.statusText} (${method} ${describeURL(url)})`,
        );
      return response;
    }
  }

  /** One hop, sent again when the connection is reset and `maxRetries` allows */
  private async hop(
    request: {
      url: URL;
      method: string;
      headers: Record<string, string>;
      body: Buffer | undefined;
    },
    options: RequestOptions,
    timeout: number,
    signal: AbortSignal,
  ) {
    const retries = options.maxRetries ?? 0;
    for (let attempt = 0; ; attempt++) {
      try {
        return await sendHop({
          ...request,
          ignoreHTTPSErrors:
            options.ignoreHTTPSErrors ??
            this.options.ignoreHTTPSErrors ??
            false,
          timeout,
          signal,
        });
      } catch (err) {
        const again =
          err instanceof TransportError &&
          err.code === "ECONNRESET" &&
          attempt < retries &&
          !signal.aborted;
        if (!again) throw prefixed(err);
      }
    }
  }

  private urlOf(given: string, params: RequestOptions["params"]): URL {
    let url: URL;
    try {
      if (HAS_SCHEME.test(given) && !RELATIVE_URL.test(given))
        url = new URL(given);
      else {
        const base = this.options.baseURL ?? peekRunSettings()?.baseURL;
        if (!base)
          throw new Error(
            `fetch(): "${given}" needs a baseURL; set one in samurai.config.ts, the environment or request.newContext()`,
          );
        url = new URL(given, base);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("fetch():")) throw err;
      throw new Error(`fetch(): "${given}" is not a valid URL`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error(`fetch(): "${given}" must be an http or https URL`);
    if (params !== undefined) {
      if (typeof params === "object" && !(params instanceof URLSearchParams)) {
        for (const [key, value] of Object.entries(params))
          url.searchParams.set(key, String(value));
      } else
        for (const [key, value] of new URLSearchParams(params))
          url.searchParams.append(key, value);
    }
    return url;
  }

  private headersOf(
    perCall: Record<string, string> | undefined,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "*/*",
      "accept-encoding": "gzip,deflate,br",
      "user-agent": "samurai-framework",
    };
    for (const source of [this.options.extraHTTPHeaders, perCall])
      for (const [name, value] of Object.entries(source ?? {}))
        headers[name.toLowerCase()] = String(value);
    return headers;
  }
}

function withoutBody(headers: Record<string, string>) {
  const rest = { ...headers };
  delete rest["content-type"];
  delete rest["content-length"];
  return rest;
}

function prefixed(err: unknown): Error {
  return err instanceof TransportError
    ? new Error(`fetch(): ${err.message}`)
    : (err as Error);
}
