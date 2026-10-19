import { peekRunSettings } from "../config/run-settings.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import { UnsupportedOperationError } from "../transport/unsupported.js";
import { WaitTimeoutError } from "../wait/wait-until.js";
import type { DocumentWatcher } from "./document-watcher.js";
import { LoadStateTimeoutError, NavigationError } from "./navigation-error.js";
import type { PageConfig, ReadinessState } from "./page-settings.js";

export type LoadState = "load" | "domcontentloaded" | "networkidle";

export interface NavigateOptions {
  /** When navigateTo resolves. @default config `navigation.waitUntil`, then "complete" */
  wait?: ReadinessState;
  /** Time (ms) the navigation may take. @default config `navigation.timeout`, then 30000 */
  timeout?: number;
  /** Scheme added to a URL without one. @default "https" */
  protocol?: "http" | "https";
}

/** What a navigation answers with: its id (null when the browser gave none) and the URL it ended on */
export type NavigationResult = { navigation: string | null; url: string };

/** What `PageNavigation` takes from the page it belongs to */
export interface NavigationDeps {
  config: PageConfig;
  documents: DocumentWatcher;
  /** Throws when the page is closed */
  assertOpen(): void;
  /** The URL of the page now, for the text of a failed navigation */
  url(): Promise<string>;
  /** Waits for a quiet network, for the "networkidle" load state */
  waitForNetworkIdle(options: { timeout: number }): Promise<void>;
}

/** Navigating one page: `goto`, `navigateTo`, `reload` and the wait for a load state */
export class PageNavigation {
  /** The navigation started by the last navigateTo; failures of it fail a wait */
  private lastNavigation: string | undefined;
  /** Base for relative `goto` URLs; falls back to the active run's baseURL */
  private baseURL: string | undefined;

  constructor(
    private connector: BiDiConnector,
    private contextId: string,
    private deps: NavigationDeps,
  ) {}

  /** Sets the base that relative `goto` URLs resolve against; `undefined` falls back to the run's baseURL */
  public setBaseURL(url: string | undefined): void {
    this.baseURL = url;
  }

  public async goto(
    url: string,
    options?: NavigateOptions,
  ): Promise<NavigationResult> {
    if (!/^\.{0,2}\//.test(url)) return this.navigateTo(url, options);
    const base = this.baseURL ?? peekRunSettings()?.baseURL;
    if (!base) {
      throw new Error(
        `goto(): "${url}" needs a baseURL; set one in samurai.config.ts or the environment`,
      );
    }
    return this.navigateTo(new URL(url, base).href, options);
  }

  public async navigateTo(
    url: string,
    options?: NavigateOptions | ReadinessState,
    protocol?: "http" | "https",
  ): Promise<NavigationResult> {
    const given: NavigateOptions =
      typeof options === "string" ? { wait: options } : (options ?? {});
    const wait = await this.deps.config.navigationWait(given.wait);
    const timeout = await this.deps.config.navigationTimeout(given.timeout);
    // A scheme is letters followed by ":" not directly followed by a digit, so "localhost:3000" is a host
    const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(url);
    const parsedURL = hasScheme
      ? url
      : `${given.protocol ?? protocol ?? "https"}://${url}`;
    this.deps.assertOpen();
    return this.navigation(
      "navigateTo",
      async () => parsedURL,
      wait,
      timeout,
      async (sendOptions) => {
        const result = await this.connector.send(
          "browsingContext.navigate",
          { context: this.contextId, url: parsedURL, wait },
          sendOptions,
        );
        return {
          navigation: result.navigation ?? null,
          url: result.url ?? parsedURL,
        };
      },
    );
  }

  public async reload(
    options: {
      wait?: ReadinessState;
      timeout?: number;
      ignoreCache?: boolean;
    } = {},
  ): Promise<NavigationResult> {
    this.deps.assertOpen();
    const wait = await this.deps.config.navigationWait(options.wait);
    const timeout = await this.deps.config.navigationTimeout(options.timeout);
    return this.navigation(
      "reload",
      () => this.deps.url().catch(() => "the page"),
      wait,
      timeout,
      async (sendOptions) => {
        try {
          const result = await this.connector.send(
            "browsingContext.reload",
            {
              context: this.contextId,
              wait,
              ...(options.ignoreCache && { ignoreCache: true }),
            },
            sendOptions,
          );
          return { navigation: result.navigation ?? null, url: result.url };
        } catch (err) {
          if (
            options.ignoreCache &&
            err instanceof BiDiError &&
            err.code === "unsupported operation"
          ) {
            throw new UnsupportedOperationError(
              "reload(): ignoreCache is not supported by the browser",
            );
          }
          throw err;
        }
      },
    );
  }

  public async waitForLoadState(
    state: LoadState = "load",
    options: { timeout?: number } = {},
  ): Promise<void> {
    this.deps.assertOpen();
    const timeout = await this.deps.config.navigationTimeout(options.timeout);
    try {
      await this.deps.documents.waitForState(
        state === "domcontentloaded" ? "domcontentloaded" : "load",
        timeout,
        this.lastNavigation,
      );
    } catch (err) {
      if (err instanceof WaitTimeoutError)
        throw new LoadStateTimeoutError(state, timeout);
      throw err;
    }
    if (state === "networkidle")
      await this.deps.waitForNetworkIdle({ timeout });
  }

  /**
   * Runs a navigation command and settles what waiting for it means: failures become NavigationErrors, and a
   * navigation that did not wait for the load is watched so `waitForLoadState` can tell it from the old page.
   */
  private async navigation(
    operation: string,
    describe: () => Promise<string>,
    wait: ReadinessState,
    timeout: number,
    send: (options: { timeout: number }) => Promise<NavigationResult>,
  ): Promise<NavigationResult> {
    // A navigation that does not wait for the load needs watching, or waitForLoadState cannot tell it from the old page
    if (wait !== "complete") await this.deps.documents.watch();
    try {
      const result = await send({ timeout });
      this.lastNavigation = result.navigation ?? undefined;
      if (result.navigation && wait !== "complete") {
        // Tracked from now on: the document still showing is the old one until this navigation commits
        const progress = this.deps.documents.progressOf(result.navigation);
        if (wait === "interactive") progress.domContentLoaded = true;
      }
      return result;
    } catch (err) {
      if (err instanceof BiDiError) {
        const reason =
          err.code === "timeout" ? `timeout after ${timeout}ms` : err.message;
        throw new NavigationError(
          await describe(),
          reason,
          err.code,
          operation,
        );
      }
      throw err;
    }
  }
}
