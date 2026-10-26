import type { RunEvent } from "../../runner/reporter.js";
import type { WorkerPool } from "../../runner/worker-pool.js";
import type { WorkItem } from "../../runner/worker-protocol.js";
import type { SupportedBrowser } from "../../types/browser.js";
import type { NodeTest } from "./events.js";

/** The work items of a node in one browser's run: each of its tests, in that browser */
export function itemsOf(
  tests: NodeTest[],
  browser: SupportedBrowser,
  outputDir?: string,
): WorkItem[] {
  return tests.map((t, index) => ({
    index,
    file: t.file,
    testName: t.name,
    browser,
    ...(outputDir !== undefined && { outputDir }),
  }));
}

/** Runs the tests of a node on the pool and reports them as a run would */
export async function runOnPool(
  pool: Pick<WorkerPool, "run">,
  items: WorkItem[],
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
): Promise<"passed" | "failed" | "cancelled"> {
  const results = await pool.run(items, {
    signal,
    onEvent: (event) =>
      onEvent({
        type: event.type,
        name: event.item.testName,
        file: event.item.file,
        browser: event.item.browser,
        ...(event.type === "test-start" &&
          event.retry && { retry: event.retry }),
        ...(event.type === "test-end" && { result: event.result }),
      } as RunEvent),
  });
  if (signal.aborted) return "cancelled";
  // A skipped test is not a failure
  return results.every((r) => r.status === "success" || r.status === "skipped")
    ? "passed"
    : "failed";
}
