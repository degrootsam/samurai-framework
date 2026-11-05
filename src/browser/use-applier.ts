import { warnOnce } from "../logger/warn-once.js";
import type { SupportedBrowser } from "../types/browser.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { GroupUse } from "../types/config.js";
import type { BrowserContext } from "./browser-context.js";
import { cdpSend, sendRaw } from "./cdp.js";
import { applyUse, RUNTIME_OPTIONS } from "./use-commands.js";
import type { RuntimeUseOptions } from "../types/use.js";
import type Page from "./page.js";
import { cookiesOf } from "./storage-state.js";
import { loadStorageState } from "../config/storage-state-file.js";
import type { StorageState } from "../types/use.js";

/** The `use` options a browser applies to its contexts and pages, by what each browser can do (see the wiki's support matrix) */
export class UseApplier {
  private readonly state: StorageState | undefined;
  private readonly chrome: boolean;

  constructor(
    private readonly connector: BiDiConnector,
    browserName: SupportedBrowser,
    private readonly options: GroupUse,
    projectDir: string,
  ) {
    this.chrome = browserName === "chrome";
    // Read now: a wrong path fails the test before it starts
    if (options.storageState !== undefined)
      this.state = loadStorageState(options.storageState, projectDir);
    if (!this.chrome) {
      if (options.isMobile)
        warnOnce(
          "use.isMobile",
          "use.isMobile only works on Chrome: it is ignored on Firefox",
        );
      if (options.hasTouch)
        warnOnce(
          "use.hasTouch",
          "use.hasTouch only works on Chrome: it is ignored on Firefox",
        );
    }
  }

  /** What new contexts accept unless they are told otherwise */
  public get acceptInsecureCerts(): boolean | undefined {
    return this.options.acceptInsecureCerts;
  }

  /** Whether pages are laid out like a phone: Chrome only */
  public get isMobile(): boolean {
    return this.chrome && this.options.isMobile === true;
  }

  /** Whether pages have touch input: Chrome only */
  public get hasTouch(): boolean {
    return this.chrome && this.options.hasTouch === true;
  }

  /**
   * Sets up a context: the run-time options (`page.use()`'s) through BiDi, the extra headers, then the storage state.
   * An option the browser does not support is skipped with a one-time warning (`page.use()` throws instead).
   * Firefox gets JavaScript and the colour scheme when it starts (a profile setting).
   */
  public async context(context: BrowserContext): Promise<void> {
    const { options } = this;
    await applyUse(
      this.connector,
      { userContexts: [context.id] },
      this.startUp(),
      (option) =>
        warnOnce(
          `use.${option}`,
          `use.${option} is not supported by this browser: it is ignored`,
        ),
    );
    context.setRequestDefaults({
      extraHTTPHeaders: options.extraHTTPHeaders,
      ignoreHTTPSErrors: options.acceptInsecureCerts,
    });
    if (options.extraHTTPHeaders)
      await sendRaw(this.connector, "network.setExtraHeaders", {
        headers: Object.entries(options.extraHTTPHeaders).map(
          ([name, value]) => ({ name, value: { type: "string", value } }),
        ),
        userContexts: [context.id],
      });
    if (this.state) await this.restore(context, this.state);
  }

  /**
   * Sets up a page of a context this applier set up: Chrome's phone layout and colour scheme (CDP, so per page), and
   * the viewport a group asked for (after the phone layout, so the size keeps it)
   */
  public async page(page: Page): Promise<void> {
    if (this.chrome) await this.chromePage(page);
    if (this.options.viewport !== undefined)
      await page.setViewport(this.options.viewport);
  }

  /**
   * The declared options that go through BiDi. Left out: those that are not set (or `null`), the ones that change
   * nothing (`offline: false`), Chrome-only touch on Firefox (warned once in the constructor) and JavaScript on
   * Firefox (a profile setting).
   */
  private startUp(): RuntimeUseOptions {
    const { options } = this;
    const wanted: Record<string, unknown> = {};
    for (const name of RUNTIME_OPTIONS) {
      const value = options[name];
      if (value === undefined || value === null) continue;
      if (name === "offline" && value === false) continue;
      if (name === "hasTouch" && !this.hasTouch) continue;
      if (name === "javaScriptEnabled" && !(this.chrome && value === false))
        continue;
      wanted[name] = value;
    }
    return wanted;
  }

  private async chromePage(page: Page): Promise<void> {
    if (this.isMobile) await page.setMobileLayout();
    if (this.options.colorScheme !== undefined)
      await cdpSend(
        this.connector,
        page.contextId,
        "Emulation.setEmulatedMedia",
        {
          features: [
            { name: "prefers-color-scheme", value: this.options.colorScheme },
          ],
        },
      );
  }

  private async restore(context: BrowserContext, state: StorageState) {
    const cookies = cookiesOf(state);
    if (cookies.length > 0) await context.addCookies(cookies);
    for (const { origin, localStorage } of state.origins ?? []) {
      if (localStorage.length === 0) continue;
      await writeLocalStorage(context, origin, localStorage);
    }
  }
}

/**
 * Local storage belongs to an origin, so the browser has to be on it: a scratch tab opens the origin (the request is
 * answered here, it never reaches the network), writes the entries and closes again.
 */
async function writeLocalStorage(
  context: BrowserContext,
  origin: string,
  entries: { name: string; value: string }[],
): Promise<void> {
  const tab = await context.newPage();
  try {
    await tab.route(`${origin}/**`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
    );
    await tab.navigateTo(`${origin}/`);
    await tab.evaluate(
      (items: { name: string; value: string }[]) =>
        items.forEach(({ name, value }) => localStorage.setItem(name, value)),
      entries,
    );
  } finally {
    await tab.close();
  }
}
