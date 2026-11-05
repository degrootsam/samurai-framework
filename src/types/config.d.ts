import type { StepDefinition } from "../flows/steps/define.js";
import type { SupportedBrowser } from "./browser.js";
import type { UseOptions } from "./use.js";
import type { ResolvedConfig } from "../config/resolved-config.js";

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
  /** The browsers this group's tests run in, instead of the project's `browsers` */
  browsers?: SupportedBrowser[];
  /**
   * How many of this group's tests may run at the same time. Only `1` has an effect: the group's tests run one
   * after the other, even when the run uses more workers (for tests that share an account or data). A run of
   * nothing but such a group uses one worker.
   */
  workers?: number;
}

/** One server the run starts before the first test (see `SamuraiTestConfig.webServer`). Give either `url` or `port`. */
export interface WebServerConfig {
  /** Shell command that starts the server. It leads its own process group, so the whole tree is stopped at the end */
  command: string;
  /** Where the server answers: ready once it responds with a status from 200 to 403 */
  url?: string;
  /** Where the server listens: ready once `localhost` accepts TCP connections on it */
  port?: number;
  /** Working directory of the command, relative to the project folder. @default the project folder */
  cwd?: string;
  /** Extra environment variables for the command, on top of this process's. Never printed in errors */
  env?: Record<string, string>;
  /** Time (ms) the server may take to be ready. @default 60000 */
  timeout?: number;
  /** When `url`/`port` already answers, use that server and start nothing (it is not stopped either). @default false */
  reuseExistingServer?: boolean;
  /** Send the command's stdout to this process's stdout, or drop it. @default "ignore" */
  stdout?: "pipe" | "ignore";
  /** Send the command's stderr to this process's stderr, or drop it. @default "pipe" */
  stderr?: "pipe" | "ignore";
  /** Do not fail on a certificate error while waiting for an `https` `url`. @default false */
  ignoreHTTPSErrors?: boolean;
  /**
   * How the server is stopped: `signal` goes to the whole process group, and after `timeout` ms what is left is
   * killed. @default { signal: "SIGTERM", timeout: 5000 }
   */
  gracefulShutdown?: { signal?: "SIGTERM" | "SIGINT"; timeout?: number };
}

/** What `globalSetup` and `globalTeardown` receive: the project's resolved config, with the run's environment and base URL */
export type GlobalHookConfig = ResolvedConfig & {
  /** The environment the run uses */
  environment: string;
};

/** A run-level hook; `globalSetup` may return a function that runs as teardown too */
export type GlobalSetupFunction = (
  config: GlobalHookConfig,
) =>
  | void
  | (() => void | Promise<void>)
  | Promise<void | (() => void | Promise<void>)>;

export type GlobalTeardownFunction = (
  config: GlobalHookConfig,
) => void | Promise<void>;

export interface SamuraiEnvironment {
  /** Where page.goto('/…') resolves to in this environment, and where recordings start */
  baseURL?: string;
  /** Overrides the project timeout (ms) for this environment */
  timeout?: number;
  expect?: { timeout?: number };
  /** Overrides `use.headless` for this environment, e.g. `true` for a `ci` environment */
  headless?: boolean;
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
   * The browsers the tests run in, one after the other: every selected test runs once in each. A group can name its own.
   * @default ["firefox"]
   */
  browsers?: SupportedBrowser[];
  /**
   * How many tests run at the same time, each in a worker process of its own: a whole number from 1, or a share of
   * the CPUs like `"50%"`. `--workers` and `SAMURAI_WORKERS` win over it. A config passed as an object, not read
   * from `samurai.config.ts`, runs on one worker.
   * @default half the CPUs
   */
  workers?: number | string;
  /**
   * How many times a failing test is run again, each time with a fresh browser. A test that passes on a retry is
   * reported as flaky and does not fail the run; a run that is aborted is never retried. `--retries` and
   * `SAMURAI_RETRIES` win over it.
   * @default 0
   */
  retries?: number;
  /**
   * Refuse a run when a spec contains `test.only` or `describe.only`, so a forgotten focus cannot quietly shrink a
   * suite. The run stops before any test starts and lists the tests.
   * @default true when the `CI` environment variable is set, else false
   */
  forbidOnly?: boolean;
  /**
   * Browser binaries to launch instead of the builds SAMURAI downloads, relative to the project.
   * `SAMURAI_FIREFOX_PATH` / `SAMURAI_CHROME_PATH` win over these.
   */
  browserPaths?: { firefox?: string; chrome?: string };
  /**
   * The timeout (in ms) to use for all tests
   * @default 30000
   */
  timeout?: number;
  /**
   * Define a group of test's you want to have executed with a certain configuration
   **/
  groups?: SamuraiGroup[];
  /**
   * Flow steps of this project, made with `defineStep`. Listed after the built-in steps;
   * a kind a built-in or another step uses is refused.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps?: readonly StepDefinition<any>[];
  /**
   * The base URL to use when navigating the browser.
   * When recording starts, the browser will start at this URL.
   */
  baseURL?: string;
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
  /**
   * Folder, relative to the project folder, where recorded uploads are stored and committed with the tests
   * @default "files"
   */
  filesDir?: string;
  /** How pages are opened, and what the browser pretends: the options of `test.use()` apply to every test */
  use?: UseOptions & {
    /**
     * Size of the page's viewport, so screenshots and layout are the same on every machine.
     * `null` keeps the browser's own size
     * @default { width: 1280, height: 720 }
     */
    viewport?: { width: number; height: number } | null;
    /**
     * Run the browser without a window. Needed on machines without a display, such as CI runners.
     * Left out, a run is headless when the `CI` environment variable is set and shows a window otherwise
     */
    headless?: boolean;
    /**
     * Make an action or read on a locator that matches several elements throw
     * `name(): strict mode violation, N elements match ...` instead of using the first one. Narrow the locator
     * (`first()`, `nth()`, `filter()`) or turn it off for one locator with `locator.strict(false)`
     * @default false
     */
    strictSelectors?: boolean;
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
  /**
   * Servers the run starts before the first test and stops after the last. Each waits until its `url` answers or
   * its `port` accepts connections. When no `baseURL` is configured (project or environment), the first server's
   * `url` origin (or `http://localhost:<port>`) becomes the base URL. Only a run (`samurai run`, `runTests`)
   * starts them, not `list` or the recorder.
   */
  webServer?: WebServerConfig | WebServerConfig[];
  /**
   * Module (path relative to the project folder) whose default export `async (config) => void | teardown` runs once
   * before the tests, after the web servers are up; or the function itself. Variables it sets in `process.env`
   * reach the tests, workers included. A function it returns runs as teardown.
   */
  globalSetup?: string | GlobalSetupFunction;
  /** Module (path relative to the project folder) whose default export runs once after the tests; or the function itself */
  globalTeardown?: string | GlobalTeardownFunction;
  /** Keyed by name: 'dev', 'staging', 'production' */
  environments?: Record<string, SamuraiEnvironment>;
  /** Used when no environment is chosen with --env or SAMURAI_ENV */
  defaultEnvironment?: string;
}
