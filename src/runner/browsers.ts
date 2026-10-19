import type { SupportedBrowser } from "../types/browser.js";
import type { SamuraiTestConfig } from "../types/config.js";

/** Every browser a config may name, in the order the messages list them */
export const BROWSER_NAMES: readonly SupportedBrowser[] = ["firefox", "chrome"];

/** The browsers of a run that names none */
export const DEFAULT_BROWSERS: readonly SupportedBrowser[] = ["firefox"];

const isBrowser = (value: unknown): value is SupportedBrowser =>
  typeof value === "string" &&
  (BROWSER_NAMES as readonly string[]).includes(value);

/** Throws when `list` is not a non-empty list of distinct browser names; `where` names the key in the message */
export function checkBrowserList(list: unknown, where: string): void {
  if (!Array.isArray(list) || list.length === 0)
    throw new Error(`${where} must list at least one browser.`);
  const seen = new Set<string>();
  for (const name of list) {
    if (!isBrowser(name))
      throw new Error(
        `Unknown browser "${String(name)}" in ${where}. Choose ${BROWSER_NAMES.join(" or ")}.`,
      );
    if (seen.has(name))
      throw new Error(`Browser "${name}" is listed twice in ${where}.`);
    seen.add(name);
  }
}

/**
 * Checks the browser keys of a config: the removed `browser`, and `browsers` on the project and on each group.
 * Throws an Error that says what to write instead.
 */
export function validateBrowserConfig(config: SamuraiTestConfig): void {
  const legacy = (config as { browser?: unknown }).browser;
  if (legacy !== undefined)
    throw new Error(
      `"browser" was replaced by "browsers": use browsers: [${JSON.stringify(legacy)}]`,
    );
  if (config.browsers !== undefined)
    checkBrowserList(config.browsers, "browsers");
  config.groups?.forEach((group, index) => {
    if (group.browsers !== undefined)
      checkBrowserList(group.browsers, `groups[${index}].browsers`);
  });
}

/**
 * The browsers a run uses, the first that is set winning: the command line, the group being run, the project, then
 * Firefox. An empty list counts as not given.
 */
export function browsersFor(sources: {
  flag?: readonly SupportedBrowser[] | undefined;
  group?: readonly SupportedBrowser[] | undefined;
  project?: readonly SupportedBrowser[] | undefined;
}): SupportedBrowser[] {
  for (const list of [sources.flag, sources.group, sources.project])
    if (list && list.length > 0) return [...list];
  return [...DEFAULT_BROWSERS];
}
