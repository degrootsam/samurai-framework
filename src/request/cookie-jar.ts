import type { StorageStateCookie } from "../types/use.js";

/** A cookie as the jar keeps it */
export interface StoredCookie {
  name: string;
  value: string;
  /** Lower case, no leading dot */
  domain: string;
  /** True when no `Domain` was given: only that exact host gets the cookie */
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  /** Seconds since the epoch; absent for a session cookie, in the past for a cookie the site deletes */
  expires?: number;
}

/** Where a request context reads the cookies it sends and writes the ones it receives: its own jar, or a browser context */
export interface CookieStore {
  /** The `Cookie` header value for a request to `url`; `undefined` when no cookie applies */
  cookieHeader(url: URL): Promise<string | undefined>;
  /** Stores the cookies of the `Set-Cookie` headers a response from `url` carried (one entry per header) */
  store(url: URL, setCookies: string[]): Promise<void>;
  /** Every cookie, as a storage state lists them */
  list(): Promise<StorageStateCookie[]>;
}

const SAME_SITE = { strict: "Strict", lax: "Lax", none: "None" } as const;
const INTEGER = /^-?\d+$/;

function isLoopback(host: string): boolean {
  return (
    host === "localhost" || host === "[::1]" || /^127(\.\d+){3}$/.test(host)
  );
}

/** The default path of a cookie set without `Path`: the directory of the request path */
function defaultPath(pathname: string): string {
  const last = pathname.lastIndexOf("/");
  return pathname.startsWith("/") && last > 0 ? pathname.slice(0, last) : "/";
}

function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * One `Set-Cookie` header of a response from `url`. `undefined` for a header that is not a cookie (no name, or a
 * `Domain` the host does not belong to, which a browser would refuse as well).
 */
export function parseSetCookie(
  header: string,
  url: URL,
  now = Date.now(),
): StoredCookie | undefined {
  const [pair = "", ...attributes] = header.split(";");
  const eq = pair.indexOf("=");
  if (eq < 0) return undefined;
  const name = pair.slice(0, eq).trim();
  if (name === "") return undefined;
  const cookie: StoredCookie = {
    name,
    value: pair.slice(eq + 1).trim(),
    domain: url.hostname.toLowerCase(),
    hostOnly: true,
    path: defaultPath(url.pathname),
    secure: false,
    httpOnly: false,
  };
  let maxAge: number | undefined;
  for (const attribute of attributes) {
    const at = attribute.indexOf("=");
    const key = (at < 0 ? attribute : attribute.slice(0, at))
      .trim()
      .toLowerCase();
    const value = at < 0 ? "" : attribute.slice(at + 1).trim();
    if (key === "domain" && value !== "") {
      const domain = value.replace(/^\./, "").toLowerCase();
      if (!domainMatches(cookie.domain, domain)) return undefined;
      cookie.domain = domain;
      cookie.hostOnly = false;
    } else if (key === "path" && value.startsWith("/")) cookie.path = value;
    else if (key === "secure") cookie.secure = true;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "samesite" && value.toLowerCase() in SAME_SITE)
      cookie.sameSite =
        SAME_SITE[value.toLowerCase() as keyof typeof SAME_SITE];
    else if (key === "max-age" && INTEGER.test(value)) maxAge = Number(value);
    else if (key === "expires") {
      const time = Date.parse(value);
      if (!Number.isNaN(time)) cookie.expires = Math.floor(time / 1000);
    }
  }
  // Max-Age wins over Expires
  if (maxAge !== undefined)
    cookie.expires = maxAge <= 0 ? 0 : Math.floor(now / 1000) + maxAge;
  return cookie;
}

export function isExpired(cookie: StoredCookie, now = Date.now()): boolean {
  return cookie.expires !== undefined && cookie.expires * 1000 <= now;
}

/**
 * Whether a request to `url` carries `cookie`: host, path, `Secure` (https, or a loopback host the browsers treat
 * as secure) and expiry. `SameSite` is not applied: a request made by the test is not made from another site.
 */
export function cookieMatches(
  cookie: StoredCookie,
  url: URL,
  now = Date.now(),
): boolean {
  if (isExpired(cookie, now)) return false;
  const host = url.hostname.toLowerCase();
  if (
    cookie.hostOnly
      ? host !== cookie.domain
      : !domainMatches(host, cookie.domain)
  )
    return false;
  const { path } = cookie;
  const here = url.pathname || "/";
  const underPath =
    here === path ||
    (here.startsWith(path) &&
      (path.endsWith("/") || here[path.length] === "/"));
  if (!underPath) return false;
  return !cookie.secure || url.protocol === "https:" || isLoopback(host);
}

/** The `Cookie` header value for `cookies`: the longest path first, as a browser sends them */
export function cookieHeaderOf(cookies: StoredCookie[]): string | undefined {
  if (cookies.length === 0) return undefined;
  return [...cookies]
    .sort((a, b) => b.path.length - a.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

/** The cookies of an in-memory request context: what its responses set, and what a storage state seeded */
export class CookieJar implements CookieStore {
  private cookies: StoredCookie[] = [];

  constructor(seed: readonly StorageStateCookie[] = []) {
    for (const cookie of seed) this.put(fromStorageState(cookie));
  }

  public cookieHeader(url: URL): Promise<string | undefined> {
    const now = Date.now();
    this.cookies = this.cookies.filter((cookie) => !isExpired(cookie, now));
    return Promise.resolve(
      cookieHeaderOf(this.cookies.filter((c) => cookieMatches(c, url, now))),
    );
  }

  public store(url: URL, setCookies: string[]): Promise<void> {
    for (const header of setCookies) {
      const cookie = parseSetCookie(header, url);
      if (cookie) this.put(cookie);
    }
    return Promise.resolve();
  }

  public list(): Promise<StorageStateCookie[]> {
    const now = Date.now();
    return Promise.resolve(
      this.cookies
        .filter((cookie) => !isExpired(cookie, now))
        .map(toStorageState),
    );
  }

  /** Replaces the cookie with the same name, domain and path; an expired one only removes it */
  private put(cookie: StoredCookie): void {
    this.cookies = this.cookies.filter(
      (old) =>
        old.name !== cookie.name ||
        old.domain !== cookie.domain ||
        old.path !== cookie.path,
    );
    if (!isExpired(cookie)) this.cookies.push(cookie);
  }
}

function fromStorageState(cookie: StorageStateCookie): StoredCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain.replace(/^\./, "").toLowerCase(),
    hostOnly: !cookie.domain.startsWith("."),
    path: cookie.path ?? "/",
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    ...(cookie.sameSite !== undefined && { sameSite: cookie.sameSite }),
    ...(cookie.expires !== undefined &&
      cookie.expires > 0 && { expires: cookie.expires }),
  };
}

function toStorageState(cookie: StoredCookie): StorageStateCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.hostOnly ? cookie.domain : `.${cookie.domain}`,
    path: cookie.path,
    expires: cookie.expires ?? -1,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite ?? "Lax",
  };
}
