import type {
  AnyNodeDefinition,
  ExpressionContext,
  FlowFacts,
  FlowFile,
  FlowNodeModel,
} from "../../core/index.js";
import type { OutputsById } from "../branch-context.js";
import type { RunEvent } from "../../../runner/reporter.js";
import type { SupportedBrowser } from "../../../types/browser.js";
import type { NodeResult, NodeTest } from "../events.js";

/** What a handler can use of the run */
export interface HandlerRun {
  flow: FlowFile;
  environment: { name: string; variables: Record<string, unknown> };
  context: ExpressionContext;
  /** The outputs the nodes that ran saved, by node id: where wired inputs come from */
  outputsById: OutputsById;
  /** The project's tests' inputs and outputs and its groups' tests; without them no input is wired */
  facts?: FlowFacts;
  nodeTests: Record<string, NodeTest[]>;
  /** The browser this run is in: a flow runs once per browser */
  browser: SupportedBrowser;
  /** The browsers each node runs in; a node not listed runs in every one */
  nodeBrowsers?: Record<string, SupportedBrowser[]>;
  signal: AbortSignal;
  /** Runs a node's tests in `browser`, with values for their inputs */
  runTests: (
    nodeId: string,
    tests: NodeTest[],
    onEvent: (e: RunEvent) => void,
    inputs?: Record<string, string>,
  ) => Promise<"passed" | "failed" | "cancelled">;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  onTestEvent: (nodeId: string, e: RunEvent) => void;
  /** Definitions of kinds core doesn't have (steps), for expression scopes */
  nodes: readonly AnyNodeDefinition[];
  log: (nodeId: string, level: "info" | "warn" | "error", text: string) => void;
}

/** What a handler decides; the walker adds timing */
export type Outcome = Omit<NodeResult, "durationMs"> | "cancelled";

/** Runs one kind of node. A `branches` node names the branch it takes in `branch` */
export type Handler = (
  node: FlowNodeModel,
  run: HandlerRun,
) => Promise<Outcome>;
