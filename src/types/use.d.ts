/**
 * How the page looks to the site, and what the browser starts with. One vocabulary for every level: config `use`,
 * a group's `use`, `test.use()` (fixed before the test starts) and `page.use()` / `context.use()` (applied now).
 * At run time `null` puts the real value back; in config a later layer's `null` cancels an earlier value.
 */
export interface UseOptions {
  /** A BCP 47 tag, e.g. "nl-NL": `navigator.language`, `Intl` formatting and the `Accept-Language` header */
  locale?: string | null;
  /** An IANA timezone, e.g. "Europe/Amsterdam" */
  timezone?: string | null;
  /** The `User-Agent` header and `navigator.userAgent` */
  userAgent?: string | null;
  /** Needs the geolocation permission: see `page.grantPermission("geolocation")` */
  geolocation?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  } | null;
  /** `true`: no network (`navigator.onLine` is false and requests fail); `false`: back online */
  offline?: boolean | null;
  /** "portrait" and "landscape" mean the primary orientation of that kind */
  orientation?: Orientation | null;
  /** The size `screen.width` and `screen.height` report */
  screen?: { width: number; height: number } | null;
  /** `false` runs pages without JavaScript */
  javaScriptEnabled?: boolean | null;
  /** Touch input: `navigator.maxTouchPoints` is 1. Chrome only. */
  hasTouch?: boolean | null;
  /** Accept certificates that are self-signed, expired or for another host. Fixed when the browser starts. */
  acceptInsecureCerts?: boolean;
  /** A phone-like browser (the layout viewport follows the page's `<meta name="viewport">`). Chrome only. */
  isMobile?: boolean;
  /** Cookies and local storage to start with: a JSON file (relative to the project folder) or the object itself */
  storageState?: string | StorageState;
  /** Headers added to every request of the page */
  extraHTTPHeaders?: Record<string, string>;
  /** What `prefers-color-scheme` reports */
  colorScheme?: ColorScheme;
}

/** The options `page.use()` and `context.use()` take: those that can change while the browser runs */
export type RuntimeUseOptions = Pick<
  UseOptions,
  | "locale"
  | "timezone"
  | "userAgent"
  | "geolocation"
  | "offline"
  | "orientation"
  | "screen"
  | "javaScriptEnabled"
  | "hasTouch"
>;

export type Orientation =
  | "portrait"
  | "landscape"
  | "portrait-primary"
  | "portrait-secondary"
  | "landscape-primary"
  | "landscape-secondary";

export type ColorScheme = "light" | "dark" | "no-preference";

/** Cookies and local storage, in the format Playwright's `storageState` files use */
export interface StorageState {
  cookies?: StorageStateCookie[];
  origins?: {
    origin: string;
    localStorage: { name: string; value: string }[];
  }[];
}

export interface StorageStateCookie {
  name: string;
  value: string;
  domain: string;
  /** @default "/" */
  path?: string;
  /** Seconds since the epoch; -1 or left out is a session cookie */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}
