import path from "path";
import { pathToFileURL } from "url";
import { loadRawConfig } from "../config/config.js";
import logger from "../logger/index.js";
import type { SupportedBrowser } from "../types/browser.js";
import type { RegisteredTestCase } from "../types/test.js";
import { browsersFor } from "../config/browsers-for.js";
import {
  findGroup,
  resolveGroups,
  testId,
  toPosix,
  type ResolvedGroup,
} from "./groups.js";
import { assertModuleProject } from "./module-type.js";
import type { RunnerOptions } from "./options.js";
import { clearRegistry, registeredTests } from "./registry.js";
import { realDirs } from "./test-dir.js";

/** The specs a run imported, with the config's groups resolved against them */
export interface LoadedSpecs {
  all: RegisteredTestCase[];
  groups: ResolvedGroup[];
  /** The real `srcDir` the groups were resolved against */
  srcDir: string;
}

/** Whether a test with this full name is selected by the options */
export function isSelected(
  name: string,
  { grep, testNames }: Pick<RunnerOptions, "grep" | "testNames">,
): boolean {
  if (testNames && !testNames.includes(name)) return false;
  if (grep === undefined) return true;
  if (typeof grep === "string") return name.includes(grep);
  grep.lastIndex = 0;
  return grep.test(name);
}

/**
 * Imports the spec files and returns every test they register. A fresh registry and a fresh import of each
 * file, so a second run in this process registers its tests again (and sees edited specs, for files loaded as
 * ES modules; CommonJS files stay cached until the process ends)
 */
async function registerAll(testFiles: string[]): Promise<RegisteredTestCase[]> {
  clearRegistry();
  const stamp = `?run=${Date.now().toString(36)}`;
  for (const file of testFiles) assertModuleProject(file);
  for (const file of testFiles) {
    logger.verbose("Trying to register file: %s", file);
    await import(pathToFileURL(file).href + stamp);
  }
  return [...registeredTests()];
}

/** Id of a registered test: its spec file relative to `srcDir`, then its name */
export function idOf(test: RegisteredTestCase, srcDir: string): string {
  return testId(toPosix(path.relative(srcDir, test.file)), test.name);
}

/** The config's groups, resolved against the tests the specs register */
async function resolveAll(tests: RegisteredTestCase[]) {
  const config = await loadRawConfig();
  const { dir, srcDir } = realDirs(config.srcDir);
  const groups = resolveGroups(
    config,
    tests.map(({ file, name }) => ({
      file: toPosix(path.relative(srcDir, file)),
      name,
    })),
    dir,
    srcDir,
  );
  return { groups, srcDir };
}

/** Imports the spec files once and resolves the config's groups against what they registered */
export async function loadSpecs(testFiles: string[]): Promise<LoadedSpecs> {
  const all = await registerAll(testFiles);
  return { all, ...(await resolveAll(all)) };
}

/** The group names the options select, once each and in the order given; none when no group is selected */
export function groupNamesOf(group: RunnerOptions["group"]): string[] {
  return [...new Set(group === undefined ? [] : [group].flat())];
}

/** The tests the options select: by `group` (in any of them), `testNames` and `grep`; each test once */
export function selectTests(
  { all, groups, srcDir }: LoadedSpecs,
  options: RunnerOptions,
): RegisteredTestCase[] {
  const names = groupNamesOf(options.group);
  let inGroup: (test: RegisteredTestCase) => boolean = () => true;
  if (names.length > 0) {
    const members = new Set(
      names.flatMap((name) => findGroup(groups, name).testIds),
    );
    inGroup = (test) => members.has(idOf(test, srcDir));
  }
  return all.filter((test) => inGroup(test) && isSelected(test.name, options));
}

/**
 * The runs of the selected tests: without a selected group, the tests as they are; else one copy per selected group
 * that holds the test (its `group` set), the first group's tests first
 */
export function expandByGroup(
  selected: RegisteredTestCase[],
  { groups, srcDir }: LoadedSpecs,
  options: RunnerOptions,
): RegisteredTestCase[] {
  const names = groupNamesOf(options.group);
  if (names.length === 0) return selected;
  return names.flatMap((name) => {
    const members = new Set(findGroup(groups, name).testIds);
    return selected
      .filter((test) => members.has(idOf(test, srcDir)))
      .map((test) => ({ ...test, group: name }));
  });
}

/**
 * The browsers a run of a test uses: the options' (`--browser`), else its group's, else the project's, else Firefox
 */
export async function browserPlan(
  groups: ResolvedGroup[],
  options: RunnerOptions,
): Promise<{
  /** Every browser of the run, in the order they run */
  browsers: SupportedBrowser[];
  /** The browsers one run of a test uses */
  browsersOf(test: RegisteredTestCase): SupportedBrowser[];
}> {
  const { browsers: flag } = options;
  const config = await loadRawConfig();
  const names = groupNamesOf(options.group);
  const flagged = flag && flag.length > 0;
  const ofGroup = new Map(
    names.map((name) => [name, findGroup(groups, name).browsers]),
  );
  const project = browsersFor({ flag, project: config.browsers });
  const forGroup = (name: string) =>
    flagged ? project : (ofGroup.get(name) ?? project);
  const browsers = [
    ...new Set(names.length > 0 ? names.flatMap(forGroup) : project),
  ];
  return {
    browsers,
    browsersOf: (test) =>
      test.group === undefined ? project : forGroup(test.group),
  };
}
