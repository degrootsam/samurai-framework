import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { ensureWarm } from "../browser/warm-up.js";
import { readConfig } from "../config/config.js";
import { browsersFor } from "../runner/browsers.js";
import { DEFAULT_PORT } from "../runner/ports.js";
import type { SupportedBrowser } from "../types/browser.js";

interface BrowserChoice {
  browser?: SupportedBrowser | undefined;
  port?: number | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * The browser a recording uses: the one asked for, else the first of the project's (recording in two browsers at
 * once makes no sense). A fresh build is started once first, so a missing browser or a slow first start stops
 * the recording before the spec is touched.
 */
export async function prepareRecordingBrowser(
  options: BrowserChoice,
): Promise<SupportedBrowser> {
  const name =
    options.browser ??
    browsersFor({ project: await readConfig("browsers") })[0]!;
  await ensureWarm(
    name,
    { port: options.port ?? DEFAULT_PORT },
    options.signal,
  );
  options.signal?.throwIfAborted();
  return name;
}

/** Opens the browser of `prepareRecordingBrowser` */
export function launchRecordingBrowser(
  name: SupportedBrowser,
  options: BrowserChoice & { headless: boolean },
): Promise<{ browser: Browser; page: Page }> {
  return Browser.launch(
    name,
    { port: options.port ?? DEFAULT_PORT, headless: options.headless },
    options.signal,
  );
}
