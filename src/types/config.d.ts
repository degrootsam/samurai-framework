import type { SupportedBrowser } from "./browser.js";

export interface SamuraiTestConfig {
  /**
   * directory containing all the test files
   * @default "./src"
   */
  srcDir: string;
  browser: SupportedBrowser;
  timeout: number;
}
