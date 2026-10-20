import type Page from "../browser/page.js";
import type { ElementHandle } from "../script/element-handle.js";
import { locatorFromSpec } from "../steps/build.js";
import type { LocatorCall, LocatorSpec } from "../steps/model.js";

/**
 * Picks the locators for `target` from `candidates` (most stable first). Only a candidate that matches
 * exactly one element, the target, is used: the first becomes the primary, up to `maxFallbacks` more
 * become its fallbacks. Returns undefined when no candidate qualifies.
 */
export async function rankLocator(
  page: Page,
  target: ElementHandle,
  candidates: readonly LocatorCall[],
  maxFallbacks = 2,
): Promise<LocatorSpec | undefined> {
  const verified: LocatorCall[] = [];
  for (const candidate of candidates) {
    // The primary plus `maxFallbacks` fallbacks: stop once one more than that is verified
    if (verified.length > maxFallbacks) break;
    const found = await locatorFromSpec(page, {
      chain: [candidate],
      fallbacks: [],
    }).elements();
    if (found.length === 1 && found[0]!.sharedId === target.sharedId)
      verified.push(candidate);
  }
  return specOf(verified, maxFallbacks);
}

/** The first of `verified` as the primary, up to `maxFallbacks` more as its fallbacks; undefined when empty */
export function specOf(
  verified: readonly LocatorCall[],
  maxFallbacks = 2,
): LocatorSpec | undefined {
  const [primary, ...fallbacks] = verified;
  return (
    primary && {
      chain: [primary],
      fallbacks: fallbacks.slice(0, maxFallbacks).map((call) => [call]),
    }
  );
}
