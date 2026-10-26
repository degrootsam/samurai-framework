import type { RunEvent } from "../../runner/reporter.js";
import type { SupportedBrowser } from "../../types/browser.js";

export type NodeStatus = "passed" | "failed" | "skipped" | "not-run";

export interface NodeResult {
  status: NodeStatus;
  durationMs?: number;
  error?: string;
  /** Why it was skipped, e.g. "Not supported yet" */
  note?: string;
  /** Condition: the branch taken */
  branch?: string;
  /** What the node wrote to vars */
  wrote?: Record<string, unknown>;
  /** A step's outputs, readable later as `nodes.<key>.<name>` */
  outputs?: Record<string, unknown>;
}

/** One test of a node: absolute file and full name */
export interface NodeTest {
  file: string;
  name: string;
}

/**
 * What a flow run reports. A flow runs once per browser: every event but the last carries the browser of its run,
 * `flow-start` and `flow-end` come once per browser, and `flow-done` closes the whole thing.
 */
export type FlowEvent =
  | { type: "flow-start"; browser: SupportedBrowser; environment: string }
  | { type: "node-start"; browser: SupportedBrowser; nodeId: string }
  | {
      type: "node-end";
      browser: SupportedBrowser;
      nodeId: string;
      result: NodeResult;
    }
  | {
      type: "test";
      browser: SupportedBrowser;
      nodeId: string;
      event: RunEvent;
    }
  | { type: "flow-end"; browser: SupportedBrowser; summary: FlowSummary }
  | ({ type: "flow-done" } & FlowRunResult);

/** How one browser's walk of a flow ended */
export interface FlowSummary {
  status: "passed" | "failed" | "cancelled";
  nodes: Record<string, NodeResult>;
  vars: Record<string, unknown>;
  /** The flow couldn't be walked at all */
  error?: string;
}

/** One browser's run of a flow */
export interface FlowBrowserRun {
  browser: SupportedBrowser;
  summary: FlowSummary;
}

/**
 * How a flow run ended, across its browsers: `cancelled` when it was aborted, else `failed` when any run failed,
 * else `passed`. `runs` holds the runs that started, in the order they ran; an abort leaves the rest out
 */
export interface FlowRunResult {
  status: "passed" | "failed" | "cancelled";
  runs: FlowBrowserRun[];
}
