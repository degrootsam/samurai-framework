import type { SupportedBrowser } from "./browser.js";

interface SamuraiTest {
  /** Path relative to srcDir, e.g. 'checkout/coupons.spec.ts' */
  file: string;
  /** Full title, including describe blocks: 'Guest checkout > applies coupon' */
  title: string;
}

export interface SamuraiGroup {
  name: string;
  /**
   * Directory to search for tests for this group.
   * If empty, it uses the 'srcDir'
   */
  src?: string;
  /** Glob pattern to use when searching for tests.
   *  @default "**\/*.spec.ts"
   **/
  testMatch?: string;
  /**
   * Explicitly define the tests inside the group.
   * Overrides 'src' and 'testMatch'  options.
   */
  tests?: SamuraiTest[];
}

export interface SamuraiEnvironment {
  /** Overrides the project timeout (ms) for this environment */
  timeout?: number;
  expect?: { timeout?: number };
  /** Test data, used in steps as ${name}. Never put secrets here. */
  variables?: Record<string, string | number | boolean>;
}

export interface SamuraiTestConfig {
  /**
   * directory containing all the test files
   * @default "./src"
   */
  srcDir?: string;
  /**
   * The browser to use for all tests.
   * Is overwritten by the 'browser' in a group's config
   */
  browser?: SupportedBrowser;
  /**
   * The timeout (in ms) to use for all tests
   * @default 30000
   */
  timeout: number;
  /**
   * Define a group of test's you want to have executed with a certain configuration
   **/
  groups?: SamuraiGroup[];
  /**
   * The base URL to use when navigating the browser.
   * When recording starts, the browser will start at this URL.
   */
  baseUrl?: string;
  /** Options for `expect` assertions */
  expect?: {
    /**
     * Time (ms) locator assertions, actions (click, fill, focus) and waitFor keep retrying before failing
     * @default 5000
     */
    timeout?: number;
  };
  /** Options for the WebDriver BiDi connection */
  bidi?: {
    /**
     * Time (ms) a BiDi command may wait for its reply before failing with code "timeout"
     * @default 30000
     */
    commandTimeout?: number;
  };
  /**
   * Folder below which downloads are saved: every browser gets a folder of its own in it, and removes it again
   * when nothing was downloaded
   * @default "result/downloads"
   */
  downloadsDir?: string;
  /** How pages are opened */
  use?: {
    /**
     * Size of the page's viewport, so screenshots and layout are the same on every machine.
     * `null` keeps the browser's own size
     * @default { width: 1280, height: 720 }
     */
    viewport?: { width: number; height: number } | null;
  };
  /** What to do with the browser's console output and uncaught page exceptions */
  logs?: {
    /**
     * Which tests get the page's log entries in the report: only failed ones, all, or none
     * @default "failures"
     */
    capture?: "off" | "failures" | "all";
    /**
     * Fail a test that passed when the page threw an exception nobody caught.
     * A test can opt out with `page.allowPageErrors()`
     * @default false
     */
    failOnPageError?: boolean;
    /** Uncaught exceptions whose message contains a string, or matches a RegExp, never fail a test */
    ignoreErrors?: (string | RegExp)[];
  };
  /** Options for `page.navigateTo()` and `page.waitForLoadState()` */
  navigation?: {
    /**
     * Time (ms) a navigation, or a wait for a load state, may take. Separate from `expect.timeout`:
     * loading a page legitimately takes longer than an element becoming clickable
     * @default 30000
     */
    timeout?: number;
    /**
     * When `navigateTo()` resolves: "none" right away, "interactive" at DOMContentLoaded, "complete" at load
     * @default "complete"
     */
    waitUntil?: "none" | "interactive" | "complete";
  };
  /** Options for network tracking (`page.waitForNetworkIdle()` and the request/response events) */
  network?: {
    /**
     * Follow the page's requests from the moment the browser starts. When false, `waitForNetworkIdle()` throws
     * @default true
     */
    track?: boolean;
    /**
     * Time (ms) without requests in flight that counts as idle
     * @default 500
     */
    idleTime?: number;
    /**
     * Time (ms) a `page.route` handler may take to answer a request before the request is let through
     * @default 30000
     */
    routeTimeout?: number;
    /**
     * Keep response bodies from the moment the browser starts, so `response.body()` works for every response.
     * Bodies are otherwise kept once `page.on("response")` or `page.waitForResponse()` is used, and cost browser memory
     * @default false
     */
    collectBodies?: boolean;
    /**
     * Largest response body (bytes) that is kept for `response.body()`
     * @default 10485760
     */
    maxBodySize?: number;
  };
  /** Keyed by name: 'dev', 'staging', 'production' */
  environments: Record<string, SamuraiEnvironment>;
  /** Used when no environment is chosen */
  defaultEnvironment: string;
}
