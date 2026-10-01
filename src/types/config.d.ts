import type { SupportedBrowser } from "./browser.js";

export interface SamuraiGroup {
  browser?: SupportedBrowser;
  /**
   * Directory to search for tests for this group.
   * If empty, it uses the 'srcDir'
   */
  src?: string;
  /** Glob pattern to use when searching for tests.
   *  @default "**\/*.spec.ts"
   **/
  testMatch?: string;
}

export interface SamuraiTestConfig {
  /**
   * directory containing all the test files
   * @default "./src"
   */
  srcDir: string;
  /**
   * The browser to use for all tests.
   * Is overwritten by the 'browser' in a group's config
   */
  browser: SupportedBrowser;
  /**
   * The timeout (in ms) to use for all tests
   */
  timeout: number;
  /**
   * Define a group of test's you want to have executed with a certain configuration
   **/
  groups?: SamuraiGroup[];
  /** Options for `expect` assertions */
  expect?: {
    /**
     * Time (ms) locator assertions keep retrying before failing
     * @default 5000
     */
    timeout?: number;
  };
}
