import type { ToolContext } from "./context.js";

/**
 * After something that may have moved the page (a click, a key, a navigation): when it now shows a site that is
 * not allowed, goes back to `before` and says so. Returns undefined when the page is where it may be.
 */
export async function leftAllowedOrigins(
  context: ToolContext,
  before: string,
): Promise<string | undefined> {
  await context.page.waitForLoadState("load").catch(() => undefined);
  const now = await context.page.url();
  let url: URL;
  try {
    url = new URL(now);
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(url.protocol) || context.origins.isAllowed(url))
    return undefined;
  await context.page.navigateTo(before).catch(() => undefined);
  return `the page moved to ${url.origin}, which is not an allowed site; it went back to ${before}, and nothing was written`;
}
