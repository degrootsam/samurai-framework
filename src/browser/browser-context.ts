import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { Cookie as BiDiCookie, SameSite } from "../types/bidi-modules/network.js";
import type { PartialCookie, PartitionDescriptor } from "../types/bidi-modules/storage.js";
import { applyEmulation, type EmulationOptions } from "./emulation.js";
import type Page from "./page.js";

export type { SameSite } from "../types/bidi-modules/network.js";

/** A cookie as `context.cookies()` returns it */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: SameSite;
  /** Seconds since the epoch; absent for a session cookie */
  expiry?: number;
}

/** A cookie to add: `domain`, or a `url` to take domain, path and `secure` from */
export interface CookieInput {
  name: string;
  value: string;
  domain?: string;
  /** @default "/", or the path of `url` */
  path?: string;
  url?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: SameSite;
  /** Seconds since the epoch */
  expiry?: number;
}

export interface CookieFilter {
  name?: string;
  domain?: string;
  path?: string;
}

/** What a context needs from its browser */
export interface ContextHost {
  connector: BiDiConnector;
  newPage(options: { type: "tab"; userContext?: string }): Promise<Page>;
  /** Called when a context has been closed */
  forget(context: BrowserContext): void;
}

/**
 * An isolated browsing session inside one browser: its own cookies, storage and cache. Pages opened in it
 * share them; pages of other contexts see none of it.
 */
export class BrowserContext {
  private opened: Page[] = [];
  private isClosed = false;

  constructor(
    private host: ContextHost,
    /** The BiDi user context id; "default" for the browser's own */
    public readonly id: string,
    public readonly isDefault: boolean,
  ) {}

  /** True once `close()` has run */
  public get closed(): boolean {
    return this.isClosed;
  }

  /** Opens a tab in this context */
  public async newPage(): Promise<Page> {
    this.assertOpen();
    return this.host.newPage({ type: "tab", ...(!this.isDefault && { userContext: this.id }) });
  }

  /** The pages opened in this context that are still open */
  public pages(): Page[] {
    this.opened = this.opened.filter((page) => !page.closed);
    return [...this.opened];
  }

  /** @internal Called when a page is opened in this context */
  public register(page: Page): void {
    this.opened.push(page);
    page.setContext(this);
  }

  /** Adds cookies to this context's storage. Every cookie is checked before any is stored */
  public async addCookies(cookies: CookieInput[]): Promise<void> {
    this.assertOpen();
    const prepared = cookies.map(toBiDiCookie);
    for (const cookie of prepared) {
      await this.host.connector.send("storage.setCookie", { cookie, partition: this.partition() });
    }
  }

  /** The cookies of this context, optionally only those matching `filter` */
  public async cookies(filter?: CookieFilter): Promise<Cookie[]> {
    this.assertOpen();
    const { cookies } = await this.host.connector.send("storage.getCookies", {
      ...(filter && { filter }),
      partition: this.partition(),
    });
    return cookies.map(toCookie);
  }

  /** Deletes all cookies of this context, or those matching `filter` */
  public async clearCookies(filter?: CookieFilter): Promise<void> {
    this.assertOpen();
    await this.host.connector.send("storage.deleteCookies", {
      ...(filter && { filter }),
      partition: this.partition(),
    });
  }

  /**
   * Pretends things about every page of this context, including pages opened later: locale, timezone, user agent,
   * geolocation, offline, orientation, screen size. A page's own `emulate()` wins over the context's.
   * @example
   *  await context.emulate({ locale: "nl-NL", timezone: "Europe/Amsterdam", offline: false });
   */
  public async emulate(options: EmulationOptions): Promise<void> {
    this.assertOpen();
    await applyEmulation(this.host.connector, { userContexts: [this.id] }, options);
  }

  /**
   * Grants, denies or resets a browser permission ("geolocation", "notifications", "camera", …) for `origin`
   * in this context. Geolocation emulation only answers once the permission is granted.
   */
  public async setPermission(
    name: string,
    state: "granted" | "denied" | "prompt",
    origin: string,
  ): Promise<void> {
    this.assertOpen();
    await this.host.connector.send("permissions.setPermission", {
      descriptor: { name },
      state,
      origin,
      ...(!this.isDefault && { userContext: this.id }),
    });
  }

  /** Removes the context; the browser closes its pages. The default context cannot be closed */
  public async close(): Promise<void> {
    if (this.isDefault) throw new Error("cannot close the default context");
    if (this.isClosed) return;
    try {
      await this.host.connector.send("browser.removeUserContext", { userContext: this.id });
    } catch (err) {
      // Already gone: the goal is met
      if (!(err instanceof BiDiError && err.code === "no such user context")) throw err;
    }
    this.isClosed = true;
    const pages = this.opened;
    this.opened = [];
    await Promise.all(pages.map((page) => page.detach()));
    this.host.forget(this);
  }

  private partition(): PartitionDescriptor {
    return { type: "storageKey", userContext: this.id };
  }

  private assertOpen() {
    if (this.isClosed) throw new Error("context closed");
  }
}

function toBiDiCookie(input: CookieInput): PartialCookie {
  let { domain, path, secure } = input;
  if (input.url !== undefined) {
    const url = new URL(input.url);
    domain ??= url.hostname;
    path ??= url.pathname;
    secure ??= url.protocol === "https:";
  }
  if (domain === undefined) throw new TypeError(`cookie "${input.name}" needs a domain or a url`);
  return {
    name: input.name,
    value: { type: "string", value: input.value },
    domain,
    path: path ?? "/",
    ...(secure !== undefined && { secure }),
    ...(input.httpOnly !== undefined && { httpOnly: input.httpOnly }),
    ...(input.sameSite !== undefined && { sameSite: input.sameSite }),
    ...(input.expiry !== undefined && { expiry: input.expiry }),
  };
}

function toCookie(cookie: BiDiCookie): Cookie {
  return {
    name: cookie.name,
    value:
      cookie.value.type === "base64"
        ? Buffer.from(cookie.value.value, "base64").toString("utf8")
        : cookie.value.value,
    domain: cookie.domain,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    ...(cookie.expiry !== undefined && { expiry: cookie.expiry }),
  };
}
