import type { SupportedBrowser } from "../types/browser.js";
import type { SamuraiGroup } from "../types/config.js";
import type { RegisteredTestCase, TestResult } from "../types/test.js";
import type { ResolvedGroup } from "./groups.js";
import type TestReporter from "./reporter.js";
import { idOf } from "./select.js";
import type { RunHooks } from "./worker-pool.js";
import type { WorkItem } from "./worker-protocol.js";

/** What a run needs from a worker pool: `WorkerPool` itself, or a fake in tests */
export interface PooledRunner {
  run(items: WorkItem[], hooks?: RunHooks): Promise<TestResult[]>;
}

/** A test in a browser, as the run lists it: the work item at the same position says the same in a form a worker reads */
export interface PlannedTest {
  test: RegisteredTestCase;
  browser: SupportedBrowser;
}

/**
 * Lists the run: every selected test in the first browser, then every selected test in the next one. The
 * position in the list is the item's `index`. `serialKey` says which group makes a test run alone.
 */
export function planItems(
  selected: RegisteredTestCase[],
  browsers: SupportedBrowser[],
  serialKey: (test: RegisteredTestCase) => string | undefined,
): { items: WorkItem[]; planned: PlannedTest[] } {
  const planned = browsers.flatMap((browser) =>
    selected.map((test) => ({ test, browser })),
  );
  const items = planned.map(({ test, browser }, index): WorkItem => {
    const key = serialKey(test);
    return {
      index,
      file: test.file,
      testName: test.name,
      browser,
      ...(key !== undefined && { serialKey: key }),
    };
  });
  return { items, planned };
}

/**
 * Which key makes a test run alone: the first of the config's groups with `workers: 1` that holds it. `groups`
 * and `configGroups` are the same list, resolved and as written.
 */
export function serialKeyOf(
  groups: ResolvedGroup[],
  configGroups: SamuraiGroup[] | undefined,
  srcDir: string,
): (test: RegisteredTestCase) => string | undefined {
  const keys = new Map<string, string>();
  groups.forEach((group, index) => {
    if (configGroups?.[index]?.workers !== 1) return;
    for (const id of group.testIds)
      if (!keys.has(id)) keys.set(id, `group:${group.name}`);
  });
  return (test) => keys.get(idOf(test, srcDir));
}

/**
 * How a run goes: through the pool, in this process, or in this process because the workers could not read the
 * config (it was given as an object; a worker reads `samurai.config.ts` from the project folder)
 */
export function poolMode(input: {
  workers: number;
  items: number;
  inlineConfig: boolean;
}): "pool" | "in-process" | "inline-config" {
  if (input.workers <= 1 || input.items <= 1) return "in-process";
  return input.inlineConfig ? "inline-config" : "pool";
}

/**
 * Runs the planned items on the pool and reports them as they happen. An item the pool answers without events
 * (a queued one cut short by an abort, or one whose worker died before it began) is reported here at the end.
 */
export async function runPooled(
  pool: PooledRunner,
  planned: PlannedTest[],
  items: WorkItem[],
  reporter: TestReporter,
  signal?: AbortSignal,
): Promise<void> {
  reporter.setOrder(planned);
  const started = new Set<number>();
  const ended = new Set<number>();
  const begin = (index: number) => {
    if (started.has(index)) return;
    started.add(index);
    const { test, browser } = planned[index]!;
    reporter.onTestStart(test, browser);
  };
  const end = (index: number, result: TestResult) => {
    begin(index);
    ended.add(index);
    const { test, browser } = planned[index]!;
    reporter.onRemoteEnd(test, browser, result);
  };

  const results = await pool.run(items, {
    ...(signal && { signal }),
    onEvent: (event) =>
      event.type === "test-start"
        ? begin(event.item.index)
        : end(event.item.index, event.result),
  });
  results.forEach((result, index) => {
    if (!ended.has(index)) end(index, result);
  });
}
