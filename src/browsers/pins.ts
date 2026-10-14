/** The browser builds this framework version downloads and launches. Bumped by hand in a release */
export const PINNED = {
  firefox: { buildId: "stable_158.0", label: "Firefox 158.0" },
  chrome: {
    buildId: "155.0.8059.79",
    label: "Chrome for Testing 155.0.8059.79",
  },
} as const satisfies Record<string, { buildId: string; label: string }>;

export type ManagedBrowser = keyof typeof PINNED;

export const MANAGED_BROWSERS = Object.keys(PINNED) as ManagedBrowser[];

/** The managed browsers the framework can launch; Chrome joins when it can drive it */
export const LAUNCHABLE: readonly ManagedBrowser[] = ["firefox"];

export function isManagedBrowser(name: string): name is ManagedBrowser {
  return Object.prototype.hasOwnProperty.call(PINNED, name);
}
