import { matchesGlob, relative, resolve } from "node:path";
import type { SamuraiGroup } from "../types/config.js";

/** The test folder when the config names none */
export const DEFAULT_SRC_DIR = "./src";
/** The spec pattern when a group names none */
export const DEFAULT_TEST_MATCH = "**/*.spec.ts";

/** A test as groups see it: its spec file (relative to `srcDir`, or any path inside it) and full name */
export interface GroupTest {
  file: string;
  name: string;
}

/** A group with the tests it holds */
export interface ResolvedGroup {
  name: string;
  /** `picked`: the group lists its tests; `pattern`: `src` and `testMatch` select them */
  kind: "picked" | "pattern";
  /** What selects the tests of a pattern group, for display */
  pattern?: string;
  /** Ids (see `testId`) of the found tests in the group */
  testIds: string[];
  /** Picked tests that no longer exist */
  missing: { file: string; title: string }[];
}

/** Separators of any platform become `/` */
export const toPosix = (p: string) => p.replace(/\\/g, "/");

/** The id of a test: its spec file relative to `srcDir` with `/` separators, then `::` and its full name */
export const testId = (file: string, name: string) =>
  `${toPosix(file)}::${name}`;

/** Works out which of `tests` (files relative to `srcDir`) belong to the group */
export function resolveGroup(
  group: SamuraiGroup,
  tests: GroupTest[],
  projectDir: string,
  srcDir: string,
): ResolvedGroup {
  const found = tests.map((t) => ({ ...t, id: testId(t.file, t.name) }));

  // Tests picked by hand override src and testMatch
  if (group.tests) {
    const known = new Set(found.map((t) => t.id));
    const picked = group.tests.map(({ file, title }) => ({
      file,
      title,
      id: testId(file, title),
    }));
    return {
      name: group.name,
      kind: "picked",
      testIds: picked.filter((t) => known.has(t.id)).map((t) => t.id),
      missing: picked
        .filter((t) => !known.has(t.id))
        .map(({ file, title }) => ({ file, title })),
    };
  }

  const base = group.src ? resolve(projectDir, group.src) : srcDir;
  const pattern = group.testMatch ?? DEFAULT_TEST_MATCH;
  const testIds = found
    .filter((t) => {
      const fromBase = toPosix(relative(base, resolve(srcDir, t.file)));
      return !fromBase.startsWith("..") && matchesGlob(fromBase, pattern);
    })
    .map((t) => t.id);
  return {
    name: group.name,
    kind: "pattern",
    pattern:
      [group.src, group.testMatch].filter(Boolean).join(" · ") || pattern,
    testIds,
    missing: [],
  };
}

/** Resolves every group of the config */
export function resolveGroups(
  config: { groups?: SamuraiGroup[] },
  tests: GroupTest[],
  projectDir: string,
  srcDir: string,
): ResolvedGroup[] {
  return (config.groups ?? []).map((group) =>
    resolveGroup(group, tests, projectDir, srcDir),
  );
}

/** The group called `name`, or an error naming the groups there are */
export function findGroup<T extends { name: string }>(
  groups: T[],
  name: string,
): T {
  const group = groups.find((g) => g.name === name);
  if (group) return group;
  throw new Error(
    groups.length === 0
      ? `Unknown group "${name}". No groups are configured.`
      : `Unknown group "${name}". Groups: ${groups.map((g) => g.name).join(", ")}.`,
  );
}
