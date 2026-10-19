import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectBrowser, type ResolvedBrowser } from "../browsers/resolve.js";
import logger from "../logger/index.js";
import type { SupportedBrowser } from "../types/browser.js";
import { Browser } from "./browser.js";
import type { BrowserLaunchOptions } from "./launch-flags.js";
import { BrowserStartTimeoutError } from "./session.js";

/** Written into a managed build's folder once it started there; its first start can be slow (macOS checks the new app) */
export const LAUNCHED_STAMP = ".samurai-launched";

/**
 * Starts a managed build once, before its first real use, so that slow first start happens outside a test's
 * timeout. A browser set by env or config, a stamped build, and an aborted run are skipped.
 */
export async function warmUp(
  target: ResolvedBrowser,
  launch: () => Promise<{ close(): Promise<void> }>,
  signal?: AbortSignal,
): Promise<void> {
  if (!target.buildDir) return;
  const stamp = path.join(target.buildDir, LAUNCHED_STAMP);
  if (existsSync(stamp) || signal?.aborted) return;
  logger.verbose("First start of %s", target.label);
  let browser: { close(): Promise<void> };
  try {
    browser = await launch();
  } catch (err) {
    if (signal?.aborted) return;
    if (err instanceof BrowserStartTimeoutError) throw err;
    throw new Error(
      `Could not start ${target.label} for the first time: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await browser.close();
  writeFileSync(stamp, new Date().toISOString());
}

/** Resolves the project's browser (throws when it is missing) and warms a managed build up, headless */
export async function ensureWarm(
  name: SupportedBrowser,
  launchOptions: Partial<BrowserLaunchOptions> = {},
  signal?: AbortSignal,
): Promise<void> {
  await warmUp(
    await projectBrowser(name),
    async () =>
      (await Browser.launch(name, { ...launchOptions, headless: true }, signal))
        .browser,
    signal,
  );
}
