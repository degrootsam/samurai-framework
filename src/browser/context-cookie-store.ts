import logger from "../logger/index.js";
import {
  cookieHeaderOf,
  cookieMatches,
  isExpired,
  parseSetCookie,
  type CookieStore,
  type StoredCookie,
} from "../request/cookie-jar.js";
import type { StorageStateCookie } from "../types/use.js";
import type { BrowserContext, Cookie } from "./browser-context.js";

const CAPITAL = { strict: "Strict", lax: "Lax", none: "None" } as const;

function stored(cookie: Cookie): StoredCookie {
  const sameSite = CAPITAL[cookie.sameSite as keyof typeof CAPITAL];
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain.replace(/^\./, "").toLowerCase(),
    hostOnly: !cookie.domain.startsWith("."),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(sameSite !== undefined && { sameSite }),
    ...(cookie.expiry !== undefined && { expires: cookie.expiry }),
  };
}

/**
 * The cookies of a browser context as a request context's cookie store: requests send what the pages of the
 * context hold, and the `Set-Cookie` headers of the responses go into the context, so both see one session.
 */
export class ContextCookieStore implements CookieStore {
  constructor(private readonly context: BrowserContext) {}

  public async cookieHeader(url: URL): Promise<string | undefined> {
    const now = Date.now();
    const matching = (await this.context.cookies())
      .map(stored)
      .filter((cookie) => cookieMatches(cookie, url, now));
    return cookieHeaderOf(matching);
  }

  public async store(url: URL, setCookies: string[]): Promise<void> {
    for (const header of setCookies) {
      const cookie = parseSetCookie(header, url);
      if (!cookie) continue;
      try {
        if (isExpired(cookie)) await this.remove(cookie);
        else await this.add(cookie);
      } catch (err) {
        // A browser refuses some cookies a server can send (Secure on a plain-http page, say): as a browser would
        logger.debug("The browser did not take a Set-Cookie", {
          name: cookie.name,
          err,
        });
      }
    }
  }

  public async list(): Promise<StorageStateCookie[]> {
    return (await this.context.cookies()).map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expiry ?? -1,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: CAPITAL[cookie.sameSite as keyof typeof CAPITAL] ?? "Lax",
    }));
  }

  private add(cookie: StoredCookie): Promise<void> {
    return this.context.addCookies([
      {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.hostOnly ? cookie.domain : `.${cookie.domain}`,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        ...(cookie.sameSite !== undefined && {
          sameSite: cookie.sameSite.toLowerCase() as Cookie["sameSite"],
        }),
        ...(cookie.expires !== undefined && { expiry: cookie.expires }),
      },
    ]);
  }

  /** The site deleted the cookie: the browser keeps it under the host or, for a domain cookie, the dotted domain */
  private async remove(cookie: StoredCookie): Promise<void> {
    for (const domain of [cookie.domain, `.${cookie.domain}`])
      await this.context.clearCookies({
        name: cookie.name,
        domain,
        path: cookie.path,
      });
  }
}
