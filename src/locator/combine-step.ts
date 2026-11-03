import type { ElementHandle } from "../script/element-handle.js";

/** The elements in both lists, in the order of the first */
export function intersect(
  left: readonly ElementHandle[],
  right: readonly ElementHandle[],
): ElementHandle[] {
  const wanted = new Set(right.map(({ sharedId }) => sharedId));
  return left.filter(({ sharedId }) => wanted.has(sharedId));
}

/** Both lists joined, each element once (the same node has the same `sharedId` in every search) */
export function union(
  left: readonly ElementHandle[],
  right: readonly ElementHandle[],
): ElementHandle[] {
  const seen = new Set<string>();
  return [...left, ...right].filter(({ sharedId }) => {
    if (seen.has(sharedId)) return false;
    seen.add(sharedId);
    return true;
  });
}
