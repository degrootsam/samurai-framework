/** How the page looks to the site, and what the browser starts with. Set in config `use` or with `test.use()`. */
export interface UseOptions {
  /** A BCP 47 tag, e.g. "nl-NL": `navigator.language`, `Intl` formatting and the `Accept-Language` header */
  locale?: string;
  /** An IANA timezone, e.g. "Europe/Amsterdam" */
  timezoneId?: string;
  /** The `User-Agent` header and `navigator.userAgent` */
  userAgent?: string;
  /** `false` runs pages without JavaScript */
  javaScriptEnabled?: boolean;
  /** Accept certificates that are self-signed, expired or for another host. Fixed when the browser starts. */
  acceptInsecureCerts?: boolean;
  /** Touch input: `navigator.maxTouchPoints` is 1. Chrome only. */
  hasTouch?: boolean;
  /** A phone-like browser (the layout viewport follows the page's `<meta name="viewport">`). Chrome only. */
  isMobile?: boolean;
  /** Cookies and local storage to start with: a JSON file (relative to the project folder) or the object itself */
  storageState?: string | StorageState;
  /** Headers added to every request of the page */
  extraHTTPHeaders?: Record<string, string>;
  /** What `prefers-color-scheme` reports */
  colorScheme?: ColorScheme;
}

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
