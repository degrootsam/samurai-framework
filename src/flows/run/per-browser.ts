import type { FlowFile } from "../core/index.js";
import type { SupportedBrowser } from "../../types/browser.js";
import type {
  FlowBrowserRun,
  FlowEvent,
  FlowRunResult,
  FlowSummary,
} from "./events.js";

/**
 * The browsers a flow runs in, one run each: the union of its nodes' browsers (`nodeBrowsers`, a Test node's
 * the project's and a Group node's its group's), in the order the flow's nodes first name them. `only` keeps
 * those of its browsers, in the flow's order; one no node uses is ignored, and none left is an error. A flow
 * without Test or Group nodes runs once, in the first of `only`, else the first of `projectBrowsers`.
 */
export function flowBrowsers(
  nodeBrowsers: Record<string, readonly SupportedBrowser[]>,
  flow: Pick<FlowFile, "nodes">,
  projectBrowsers: readonly SupportedBrowser[],
  only?: readonly SupportedBrowser[],
): SupportedBrowser[] {
  const union = [
    ...new Set(flow.nodes.flatMap((n) => nodeBrowsers[n.id] ?? [])),
  ];
  if (union.length === 0) return [only?.[0] ?? projectBrowsers[0]!];
  if (!only) return union;
  const kept = union.filter((b) => only.includes(b));
  if (kept.length === 0)
    throw new Error(
      `runFlowInProject(): this flow runs in none of ${only.join(", ")}`,
    );
  return kept;
}

/**
 * Walks the flow once per browser, one after the other, then sends `flow-done`. The runs are independent: a
 * failed one (an `onFailure: "stop"` included) ends that browser's run only. An abort stops them all: the runs
 * left are not started.
 */
export async function runPerBrowser(input: {
  browsers: readonly SupportedBrowser[];
  walk: (browser: SupportedBrowser) => Promise<FlowSummary>;
  signal?: AbortSignal;
  onEvent?: (event: FlowEvent) => void;
}): Promise<FlowRunResult> {
  const runs: FlowBrowserRun[] = [];
  for (const browser of input.browsers) {
    if (input.signal?.aborted) break;
    const summary = await input.walk(browser);
    runs.push({ browser, summary });
    if (summary.status === "cancelled") break;
  }
  const status: FlowRunResult["status"] =
    input.signal?.aborted || runs.some((r) => r.summary.status === "cancelled")
      ? "cancelled"
      : runs.some((r) => r.summary.status === "failed")
        ? "failed"
        : "passed";
  const result: FlowRunResult = { status, runs };
  input.onEvent?.({ type: "flow-done", ...result });
  return result;
}
