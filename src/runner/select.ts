import path from "path";
import { pathToFileURL } from "url";
import { loadConfig } from "../config/config.js";
import logger from "../logger/index.js";
import type { SupportedBrowser } from "../types/browser.js";
import type { RegisteredTestCase } from "../types/test.js";
import { browsersFor } from "./browsers.js";
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
  const config = await loadConfig();
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

/** The tests the options select: by `group`, `testNames` and `grep` */
export function selectTests(
  { all, groups, srcDir }: LoadedSpecs,
  options: RunnerOptions,
): RegisteredTestCase[] {
  const { group } = options;
  let inGroup: (test: RegisteredTestCase) => boolean = () => true;
  if (group !== undefined) {
    const members = new Set(findGroup(groups, group).testIds);
    inGroup = (test) => members.has(idOf(test, srcDir));
  }
  return all.filter((test) => inGroup(test) && isSelected(test.name, options));
}

/**
 * The browsers the run uses: the options' (`--browser`), else the selected group's, else the project's, else
 * Firefox
 */
export async function browsersOfRun(
  groups: ResolvedGroup[],
  options: RunnerOptions,
): Promise<SupportedBrowser[]> {
  const { browsers: flag, group } = options;
  const config = await loadConfig();
  const ofGroup =
    group !== undefined && !(flag && flag.length > 0)
      ? findGroup(groups, group).browsers
      : undefined;
  return browsersFor({ flag, group: ofGroup, project: config.browsers });
}
