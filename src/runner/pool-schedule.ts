import type { WorkItem } from "./worker-protocol.js";

/** What scheduling needs to know of a queued item and of a worker */
interface Queued {
  item: WorkItem;
}

export interface Worker {
  /** The unit this worker is running; it keeps the unit's items to itself until none is left */
  unit?: string | undefined;
  /** The serial key of the unit, held while the worker keeps the unit */
  unitKey?: string | undefined;
  busy?: { entry: Queued } | undefined;
}

/** The serial keys that are running, or kept by a worker between the items of its unit */
function busyKeys(workers: Worker[]): Set<string> {
  const keys = new Set<string>();
  for (const { busy, unitKey } of workers) {
    const key = busy?.entry.item.serialKey ?? unitKey;
    if (key) keys.add(key);
  }
  return keys;
}

/** The units workers are running: no other worker may take their items */
function heldUnits(workers: Worker[]): Set<string> {
  const units = new Set<string>();
  for (const { unit } of workers) if (unit) units.add(unit);
  return units;
}

/**
 * The queue position of the next item for `worker`: one of the unit it is running, else the first whose serial
 * key is not running and whose unit is not held by a worker. -1 when there is none.
 */
export function nextEligible(
  queue: Queued[],
  workers: Worker[],
  worker: Worker,
): number {
  if (worker.unit) {
    const unit = worker.unit;
    const at = queue.findIndex(({ item }) => item.unit === unit);
    if (at >= 0) return at;
    worker.unit = worker.unitKey = undefined;
  }
  const busy = busyKeys(workers);
  const units = heldUnits(workers);
  return queue.findIndex(
    ({ item }) =>
      (!item.serialKey || !busy.has(item.serialKey)) &&
      (!item.unit || !units.has(item.unit)),
  );
}

/** How many queued items could run at the same time right now: the items of a unit count one */
export function eligibleCount(queue: Queued[], workers: Worker[]): number {
  const taken = busyKeys(workers);
  const units = heldUnits(workers);
  let count = 0;
  for (const { item } of queue) {
    if (item.unit) {
      if (units.has(item.unit)) continue;
      units.add(item.unit);
    }
    if (item.serialKey) {
      if (taken.has(item.serialKey)) continue;
      taken.add(item.serialKey);
    }
    count++;
  }
  return count;
}
