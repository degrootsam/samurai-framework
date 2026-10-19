import {
  type AnyNodeDefinition,
  type ExpressionContext,
  type FlowFile,
} from "../core/index.js";
import logger from "../../logger/index.js";
import type { RunEvent } from "../../runner/reporter.js";
import type { FlowEvent, FlowSummary, NodeTest } from "./events.js";
import { STEP_NODES } from "../steps/catalog.js";
import { HANDLERS, type Handler, type HandlerRun } from "./handlers/index.js";
import {
  assertRunnable,
  defaultSleep,
  definitionOf,
  ShapeError,
  shapeError,
} from "./prepare-flow.js";
import { FlowWalker } from "./walker.js";
import type { SupportedBrowser } from "../../types/browser.js";

export interface RunFlowOptions {
  flow: FlowFile;
  /** The tests of each Test and Group node, by node id */
  nodeTests: Record<string, NodeTest[]>;
  /** The browsers a Group node runs in (its group's); a node not listed uses the project's */
  nodeBrowsers?: Record<string, SupportedBrowser[]>;
  environment: {
    name: string;
    variables: Record<string, string | number | boolean>;
  };
  /** @default "manual" */
  trigger?: "manual";
  /** @default now */
  startedAt?: string;
  signal?: AbortSignal;
  onEvent?: (event: FlowEvent) => void;
  runTests: (input: {
    tests: NodeTest[];
    onEvent: (e: RunEvent) => void;
    signal: AbortSignal;
    /** Set for a node that runs in browsers of its own */
    browsers?: SupportedBrowser[];
  }) => Promise<"passed" | "failed" | "cancelled">;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /**
   * What a node of a kind with no handler does:
   *  - `"fail"` (default): the run does not start (an error is thrown)
   *  - `"skip"`: the node is skipped with the note "Not supported yet"
   */
  unsupported?: "fail" | "skip";
  /** The handlers by kind. @default HANDLERS */
  handlers?: Readonly<Record<string, Handler>>;
  /** Definitions of kinds core doesn't have. @default the built-in steps */
  nodes?: readonly AnyNodeDefinition[];
}

/**
 * Runs a flow: sets up what its nodes share (expression context, handler access to the tests), walks it from
 * Start (see `FlowWalker`) and reports how it ended. A flow whose shape can't run ends with an `error`; a flow
 * with a kind that has no handler throws before it starts, unless `unsupported` is `"skip"`.
 */
export async function runFlow(options: RunFlowOptions): Promise<FlowSummary> {
  const { flow, onEvent = () => {} } = options;
  const signal = options.signal ?? new AbortController().signal;
  const handlers = options.handlers ?? HANDLERS;
  const nodes = options.nodes ?? STEP_NODES;

  if ((options.unsupported ?? "fail") === "fail")
    assertRunnable(flow, nodes, handlers);

  const context: ExpressionContext = {
    env: { ...options.environment.variables },
    vars: {},
    nodes: {},
    run: {
      environment: options.environment.name,
      trigger: options.trigger ?? "manual",
      startedAt: options.startedAt ?? new Date().toISOString(),
    },
  };
  const handlerRunFor = (
    context: ExpressionContext,
    signal: AbortSignal,
  ): HandlerRun => ({
    flow,
    environment: options.environment,
    context,
    nodeTests: options.nodeTests,
    ...(options.nodeBrowsers && { nodeBrowsers: options.nodeBrowsers }),
    signal,
    sleep: options.sleep ?? defaultSleep,
    runTests: (tests, onTestEvent, browsers) =>
      options.runTests({
        tests,
        onEvent: onTestEvent,
        signal,
        ...(browsers && { browsers }),
      }),
    onTestEvent: (nodeId, event) => onEvent({ type: "test", nodeId, event }),
    nodes,
    log: (nodeId, level, text) => logger[level](`[${nodeId}] ${text}`),
  });
  const walker = new FlowWalker({
    flow,
    signal,
    handlers,
    nodes,
    handlerRunFor,
    context,
    onEvent,
  });

  onEvent({ type: "flow-start", environment: options.environment.name });
  let error: string | undefined;
  const start = flow.nodes.find(
    (n) => definitionOf(nodes, n.kind)?.shape === "start",
  );
  try {
    if (!start) throw shapeError("it has no Start.");
    await walker.walk(start.id);
  } catch (e) {
    if (!(e instanceof ShapeError)) throw e;
    error = e.message;
  }
  const results = walker.results;
  for (const node of flow.nodes)
    if (!results[node.id]) results[node.id] = { status: "not-run" };
  const status: FlowSummary["status"] =
    walker.stopped === "cancelled"
      ? "cancelled"
      : error || Object.values(results).some((r) => r.status === "failed")
        ? "failed"
        : "passed";
  const summary: FlowSummary = {
    status,
    nodes: results,
    vars: context.vars,
    ...(error ? { error } : {}),
  };
  onEvent({ type: "flow-end", summary });
  return summary;
}
