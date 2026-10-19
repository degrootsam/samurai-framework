import type { SupportedBrowser } from "../types/browser.js";

/** The browsers of a run that names none */
const DEFAULT_BROWSERS: readonly SupportedBrowser[] = ["firefox"];

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
