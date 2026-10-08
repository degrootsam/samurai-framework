import type { RunEvent } from "../../runner/reporter.js";

export type NodeStatus = "passed" | "failed" | "skipped" | "not-run";

export interface NodeResult {
  status: NodeStatus;
  durationMs?: number;
  error?: string;
  /** Why it was skipped, e.g. "Not supported yet" */
  note?: string;
  /** Condition: the branch taken */
  branch?: string;
  /** Set variable: what it wrote */
  wrote?: Record<string, unknown>;
}

/** One test of a node: absolute file and full name */
export interface NodeTest {
  file: string;
  name: string;
}

export type FlowEvent =
  | { type: "flow-start"; environment: string }
  | { type: "node-start"; nodeId: string }
  | { type: "node-end"; nodeId: string; result: NodeResult }
  | { type: "test"; nodeId: string; event: RunEvent }
  | { type: "flow-end"; summary: FlowSummary };

export interface FlowSummary {
  status: "passed" | "failed" | "cancelled";
  nodes: Record<string, NodeResult>;
  vars: Record<string, unknown>;
  /** The flow couldn't be walked at all */
  error?: string;
}
