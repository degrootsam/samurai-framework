import { printPdf, type PdfOptions } from "./pdf.js";
import { applyUse } from "./use-commands.js";
import type { RuntimeUseOptions } from "../types/use.js";
import {
  screenshotWithEvidence,
  type ScreenshotOptions,
} from "./screenshot.js";
import type { UrlPattern } from "../network/url-match.js";
import { traverseHistory } from "./history.js";
import type {
  LoadState,
  NavigateOptions,
  NavigationResult,
} from "./page-navigation.js";
import { grantPermission } from "./page-permissions.js";
import { type ReadinessState } from "./page-settings.js";
import type { Viewport } from "./viewport.js";
import type { PreloadHandle } from "../script/preload.js";
import type { PageFunction } from "../script/call-function.js";
import { readContent, readTitle, readUrl } from "./page-content.js";
import { evaluateInPage } from "./page-evaluate.js";
import { PageCore } from "./page-core.js";

/** @internal Navigation, content, viewport and the other things a page does */
export abstract class PageActions extends PageCore {
  /**
   * Runs `script` before any page script in every document this page loads from now on, and once in
   * the document that is loaded now. It runs in the page's own realm, so the page sees what it sets.
   * A function receives `arg` (which must be JSON-serializable) as its only argument;
   * a string is script source (statements) and takes no argument.
   * @example
   *  await page.addInitScript(() => { window.__testMode = true; });
   *  await page.addInitScript((flags) => { window.flags = flags; }, { beta: true });
   */
  public async addInitScript(
    script: string | ((arg?: any) => void),
    arg?: unknown,
  ): Promise<PreloadHandle> {
    this.assertOpen();
    return this.initScripts.add(this.biDiConnector, this.id, script, arg);
  }

  /** Sets the base that relative `goto` URLs resolve against; `undefined` falls back to the run's baseURL */
  public setBaseURL(url: string | undefined): void {
    this.nav.setBaseURL(url);
  }

  /** @internal The full URL `goto` would navigate to: a URL starting with "/", "./" or "../" resolves against the base URL, others stay as given. `method` names the caller in the error */
  public resolveURL(url: string, method?: string): string {
    return this.nav.resolveURL(url, method);
  }

  /**
   * Navigates like `navigateTo`, but a URL starting with "/", "./" or "../" resolves against the base URL
   * (`setBaseURL`, else the environment's `baseURL`).
   * @example
   *  await page.goto("/products");
   *  await page.goto("https://example.com", { wait: "interactive" });
   */
  public goto(
    url: string,
    options?: NavigateOptions,
  ): Promise<NavigationResult> {
    return this.nav.goto(url, options);
  }

  /**
   * Navigates to `url` and resolves when the page reached `wait` (default "complete", the load event).
   * A URL without a scheme gets `https://`. Throws NavigationError when the navigation fails or takes too long.
   * The positional form `navigateTo(url, wait, protocol)` still works.
   * @example
   *  await page.navigateTo("example.com");
   *  await page.navigateTo("localhost:3000", { wait: "interactive", protocol: "http" });
   */
  public navigateTo(
    url: string,
    options?: NavigateOptions | ReadinessState,
    protocol?: "http" | "https",
  ): Promise<NavigationResult> {
    return this.nav.navigateTo(url, options, protocol);
  }

  /**
   * Reloads the page and resolves when it reached `wait` (default like `navigateTo`). Firefox does not support
   * `ignoreCache`; asking for it throws UnsupportedOperationError.
   */
  public reload(
    options: {
      wait?: ReadinessState;
      timeout?: number;
      ignoreCache?: boolean;
    } = {},
  ): Promise<NavigationResult> {
    return this.nav.reload(options);
  }

  /** Goes back one entry in the history. False when there is none to go back to */
  public async goBack(): Promise<boolean> {
    this.assertOpen();
    return traverseHistory(this.biDiConnector, this.id, -1);
  }

  /** Goes forward one entry in the history. False when there is none */
  public async goForward(): Promise<boolean> {
    this.assertOpen();
    return traverseHistory(this.biDiConnector, this.id, 1);
  }

  /** The URL of the page now */
  public async url(): Promise<string> {
    this.assertOpen();
    return readUrl(this.biDiConnector, this.id);
  }

  /**
   * Waits until the URL matches `url` (a string equals it, or with `*` / `**` is a glob; a RegExp is tested on it;
   * a function gets it as a `URL`), then until the page reached `waitUntil` (default "load"). Also sees `pushState`.
   * @example
   *  await page.getByRole("button", { name: "Sign in" }).click();
   *  await page.waitForURL("**\/dashboard");
   */
  public waitForURL(
    url: UrlPattern | ((url: URL) => boolean),
    options?: { timeout?: number; waitUntil?: LoadState },
  ): Promise<void> {
    return this.nav.waitForURL(url, options);
  }

  /** The markup of the document now, doctype included */
  public async content(): Promise<string> {
    this.assertOpen();
    return readContent(this.biDiConnector, this.id);
  }

  /**
   * Replaces the document with `html` and waits for `waitUntil` (default "load"). Scripts and styles in it run and apply;
   * the page keeps its URL and origin (it is not a `data:` page).
   * @example
   *  await page.setContent("<button>Go</button><script>document.title = 'x'</script>");
   */
  public async setContent(
    html: string,
    options?: { timeout?: number; waitUntil?: LoadState },
  ): Promise<void> {
    return this.nav.setContent(html, options);
  }

  /** The title of the document now */
  public async title(): Promise<string> {
    this.assertOpen();
    return readTitle(this.biDiConnector, this.id);
  }

  /**
   * Runs `fn` in the page, with `arg` as its only argument, and returns the result (a promise is awaited). `fn` is a function,
   * the source of one (`"async () => ..."`), or any other string, which is an expression (`"document.title"`; it takes no argument).
   * Values come back as plain JavaScript: Date, Map, Set, RegExp, BigInt, NaN, undefined, nested objects and arrays;
   * an element as an `ElementHandle`; what cannot be copied (a function, window, error, promise) as a `RemoteObject` with its `type`.
   * The page's own error message is kept (`ScriptError`). A function written under tsx must not contain named inner functions
   * (the transpiler adds a `__name` helper the page lacks); a string always works.
   * @example
   *  const count = await page.evaluate((min) => document.querySelectorAll("li").length > min, 3);
   */
  public async evaluate<R = unknown, A = unknown>(
    fn: PageFunction<[A], R>,
    arg?: A,
  ): Promise<R> {
    this.assertOpen();
    return evaluateInPage(this.biDiConnector, this.id, fn, arg);
  }

  /**
   * Sets the size of the viewport (and, optionally, the device pixel ratio); `null` puts the browser's own size back.
   * @example
   *  await page.setViewport({ width: 390, height: 844, devicePixelRatio: 3 });
   */
  public async setViewport(viewport: Viewport | null): Promise<void> {
    this.assertOpen();
    await this.viewport.set(viewport);
  }

  /** @internal Chrome: lays this page out like a phone from now on (`use.isMobile`), including the size it has now */
  public async setMobileLayout(): Promise<void> {
    await this.viewport.setMobileLayout();
  }

  /** Playwright's name for `setViewport` */
  public setViewportSize(size: Viewport): Promise<void> {
    return this.setViewport(size);
  }

  /**
   * The size this page was last given (`setViewport`, `setViewportSize`, or the default from config `use.viewport` when the
   * browser opened it), read at once; null before one is known, after `setViewport(null)` and when config turns the viewport off.
   */
  public viewportSize(): { width: number; height: number } | null {
    return this.viewport.size();
  }

  /** Gives the page the size from config `use.viewport` (1280x720 by default); the browser does this when it opens a page */
  public async applyDefaultViewport(): Promise<void> {
    await this.viewport.applyDefault();
  }

  /**
   * Takes a screenshot and returns the image (also written to `options.path`).
   * @example
   *  await page.screenshot({ path: "out/home.png", fullPage: true });
   */
  public async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    this.assertOpen();
    return screenshotWithEvidence(
      this.biDiConnector,
      this.id,
      options,
      this.evidence,
    );
  }

  /** Waits `ms` milliseconds. Prefer waiting for something (an assertion, `waitForNetworkIdle`) when you can */
  public async waitForTimeout(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0)
      throw new RangeError(`waitForTimeout(): ms must be 0 or more, got ${ms}`);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Renders the page as a PDF and returns it (also written to `options.path`) */
  public async pdf(options: PdfOptions = {}): Promise<Buffer> {
    this.assertOpen();
    return printPdf(this.biDiConnector, this.id, options);
  }

  /**
   * Changes the `use` options that can change while the browser runs for this page only: locale, timezone, user
   * agent, geolocation, offline, orientation, screen, hasTouch, javaScriptEnabled. It wins over what the page's
   * context says; `null` puts the real (or the context's) value back. Same options as `test.use()`, applied now.
   * @example
   *  await page.use({ locale: "nl-NL", offline: true });
   */
  public async use(options: RuntimeUseOptions): Promise<void> {
    this.assertOpen();
    await applyUse(this.biDiConnector, { contexts: [this.id] }, options);
  }

  /**
   * Grants a browser permission ("geolocation", "notifications", "camera", …) to the origin this page is on,
   * or to `options.origin`. A geolocation override only answers once this is granted.
   */
  public async grantPermission(
    name: string,
    options: { origin?: string } = {},
  ): Promise<void> {
    this.assertOpen();
    await grantPermission(
      this.biDiConnector,
      () => this.url(),
      () => this.browserContext,
      name,
      options,
    );
  }

  /**
   * Waits until the page's document reached `state` (default "load"): "domcontentloaded" and "load" follow the
   * document, "networkidle" is "load" plus a quiet network (see `waitForNetworkIdle`). Resolves at once when it
   * is already there. Call it once the navigation has started; a document that is still the old one counts.
   * @example
   *  await page.locator("a[@id='next']").click();
   *  await page.waitForLoadState("domcontentloaded");
   */
  public waitForLoadState(
    state: LoadState = "load",
    options: { timeout?: number } = {},
  ): Promise<void> {
    return this.nav.waitForLoadState(state, options);
  }
}
