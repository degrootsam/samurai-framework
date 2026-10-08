export interface FlowNodeOutput {
  /** Name of the shared-context variable the node writes */
  name: string;
}

export interface FlowNodeModel {
  id: string;
  /** Short name expressions use: nodes.<key>. Lowercase letters, digits and _, unique in the flow */
  key?: string;
  /** A registered node kind (see the renderer's node definitions) */
  kind: string;
  title?: string;
  subtitle?: string;
  /** test: the project test id (file::name). group: the group name */
  ref?: { testId?: string; group?: string };
  outputs?: FlowNodeOutput[];
  /** What to do when the node fails; "stop" ends the run there */
  onFailure: "stop" | "continue";
  /** Continue in the previous node's browser session (kept in the file; the framework opens a fresh browser per test today) */
  continueSession?: boolean;
  /** Per-kind settings, named by each definition's `config.*` fields*/
  config?: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface FlowEdgeModel {
  id: string;
  source: string;
  target: string;
  /** The named branch of a node with branches (a condition's "true" or "false", a parallel's "branch-0") */
  sourceHandle?: string;
}

/** One flow, as stored in <project>/flows/<id>.flow.json */
export interface FlowFile {
  id: string;
  /** The file format version; a missing one means 1. See readFlowFile */
  version?: number;
  name: string;
  description?: string;
  /** The environment the flow runs in; the header's selection otherwise */
  envDefault?: string;
  nodes: FlowNodeModel[];
  edges: FlowEdgeModel[];
}

/** The flow file format version this framework writes and reads */
export const FLOW_VERSION = 1;

/** One step that upgrades a flow file saved at version `from` to `from + 1`. */
interface Migration {
  from: number;
  migrate: (flow: Record<string, unknown>) => Record<string, unknown>;
}

/** Steps, in order, that lift an older file to FLOW_VERSION. Empty while version 1 is the only one. */
const MIGRATIONS: Migration[] = [];

/**
 * Read a parsed flow file (JSON.parse output) into a FlowFile.
 * A missing `version` is 1; older files are migrated; a file from a newer SAMURAI throws.
 */
export function readFlowFile(raw: unknown): FlowFile {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("A flow file must be a JSON object.");
  }
  let flow = raw as Record<string, unknown>;
  const version = flow.version === undefined ? 1 : flow.version;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new Error("The flow file's version must be a positive whole number.");
  }
  if (version > FLOW_VERSION) {
    throw new Error(
      "This flow was saved by a newer SAMURAI. Update @itmetsam/samurai-framework.",
    );
  }
  if (!Array.isArray(flow.nodes))
    throw new Error("A flow file needs a nodes array.");
  if (!Array.isArray(flow.edges))
    throw new Error("A flow file needs an edges array.");
  for (let at = version; at < FLOW_VERSION; at++) {
    const step = MIGRATIONS.find((m) => m.from === at);
    if (step) flow = step.migrate(flow);
  }
  return { ...flow, version: FLOW_VERSION } as unknown as FlowFile;
}
