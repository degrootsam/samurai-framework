import type { RegisteredTestCase } from "../types/test.js";
import { serialBlockOf } from "./serial.js";
import { suiteChain } from "./suite.js";

/** One slice of a run split over several machines: slice `current` of `total`, counting from 1 */
export interface Shard {
  current: number;
  total: number;
}

/**
 * Reads a shard: `"2/4"` (the command line's `--shard`) or `{ current: 2, total: 4 }` (the `shard` run option).
 * `where` names the source in the error.
 */
export function parseShard(value: unknown, where: string): Shard {
  const shard = shardOf(value);
  if (
    shard &&
    Number.isInteger(shard.current) &&
    Number.isInteger(shard.total) &&
    shard.current >= 1 &&
    shard.current <= shard.total
  )
    return { current: shard.current, total: shard.total };
  const shown = typeof value === "string" ? value : JSON.stringify(value);
  throw new Error(
    `${where}: expected current/total with 1 <= current <= total, got ${typeof value === "string" ? `"${shown}"` : String(shown)}`,
  );
}

function shardOf(value: unknown): Shard | undefined {
  if (typeof value === "string") {
    const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(value);
    return match
      ? { current: Number(match[1]), total: Number(match[2]) }
      : undefined;
  }
  if (typeof value === "object" && value !== null) {
    const { current, total } = value as Record<string, unknown>;
    if (typeof current === "number" && typeof total === "number")
      return { current, total };
  }
  return undefined;
}

/**
 * What a shard keeps together: a serial block is never split, and so is a file, unless `fullyParallel` is on or a
 * `describe` around the test is in `"parallel"` mode: then the test goes by itself.
 */
export function shardGroupOf(
  test: RegisteredTestCase,
  fullyParallel: boolean | undefined,
): string {
  const block = serialBlockOf(test);
  if (block) return block.key;
  const alone =
    fullyParallel === true ||
    suiteChain(test.suite).some((s) => s.mode === "parallel");
  return alone ? `test:${test.file}::${test.name}` : `file:${test.file}`;
}

/**
 * The tests of one shard. The groups (in the order their first test comes) are dealt out in order, so the shards are
 * as equal in tests as whole groups allow: a group goes to the shard that holds its first test when all tests are
 * cut into `total` equal ranges. The shards are disjoint and together hold every test; the order stays.
 */
export function shardTests(
  tests: RegisteredTestCase[],
  { current, total }: Shard,
  groupOf: (test: RegisteredTestCase) => string,
): RegisteredTestCase[] {
  const groups = new Map<string, RegisteredTestCase[]>();
  for (const test of tests) {
    const key = groupOf(test);
    const members = groups.get(key);
    if (members) members.push(test);
    else groups.set(key, [test]);
  }
  const size = Math.floor(tests.length / total);
  const extra = tests.length - size * total;
  const index = current - 1;
  const from = size * index + Math.min(extra, index);
  const to = from + size + (index < extra ? 1 : 0);
  const kept = new Set<RegisteredTestCase>();
  let first = 0;
  for (const members of groups.values()) {
    if (first >= from && first < to) for (const test of members) kept.add(test);
    first += members.length;
  }
  return tests.filter((test) => kept.has(test));
}
