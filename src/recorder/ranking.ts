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
    if (verified.length > maxFallbacks) break;
    const found = await locatorFromSpec(page, { chain: [candidate], fallbacks: [] }).elements();
    if (found.length === 1 && found[0]!.sharedId === target.sharedId) verified.push(candidate);
  }
  const [primary, ...fallbacks] = verified;
  return primary && { chain: [primary], fallbacks: fallbacks.map((call) => [call]) };
}
