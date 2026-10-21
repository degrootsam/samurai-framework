import type { ProjectOptions } from "../../runner/project.js";
import type { PoolOptions, WorkerPool } from "../../runner/worker-pool.js";
import type { runTests } from "../../runner/run.js";
import type { FlowFile, FlowProblem } from "../core/index.js";
import type { FlowEvent } from "./events.js";

/** The flow has errors; nothing was run */
export class FlowCheckError extends Error {
  constructor(public readonly problems: FlowProblem[]) {
    super(
      `This flow can't run:\n${problems.map((p) => `  - ${p.message}`).join("\n")}`,
    );
    this.name = "FlowCheckError";
  }
}

export interface RunFlowInProjectOptions extends ProjectOptions {
  /** The flow to run... */
  flow?: FlowFile;
  /** ...or the id of one in `<project>/flows` */
  flowId?: string;
  /** Beats the flow's `envDefault`, the config's `defaultEnvironment` and the first environment */
  environment?: string;
  signal?: AbortSignal;
  onEvent?: (event: FlowEvent) => void;
  /** `"fail"` (default): a flow with a node that can't run is refused. `"skip"`: those nodes are skipped. */
  unsupported?: "fail" | "skip";
  port?: number;
  /**
   * The folder for the tests' named screenshots, instead of `<project>/result` (see `runTests`). Each node writes to
   * `nodes/<node id>/` inside it, so a test that runs in two nodes keeps both sets; screenshot paths in a node's
   * results are relative to that folder. Relative to the project folder
   */
  outputDir?: string;
  /**
   * How many worker processes the tests of the whole run share: a number, or a percentage like `"50%"`. Unset
   * takes `SAMURAI_WORKERS` (`workersEnv`), then the config's `workers`, then half the CPUs. 1 runs each Test
   * and Group node through `runTests` in this process; more starts one pool that every node, and every branch
   * of a Parallel node, takes its workers from
   */
  workers?: number | string;
  /** The value of `SAMURAI_WORKERS`, when set */
  workersEnv?: string;
  /** How many times a failing test is run again: a number, or numeric text like the command line's `--retries`. Unset takes `SAMURAI_RETRIES` (`retriesEnv`), then the config's `retries`, then 0 */
  retries?: number | string;
  /** The value of `SAMURAI_RETRIES`, when set */
  retriesEnv?: string;
  /** @internal Replaces the worker pool (tests) */
  createPool?: (options: PoolOptions) => Pick<WorkerPool, "run" | "dispose">;
  /** @internal Replaces the runner of each Test and Group node (tests) */
  testRunner?: typeof runTests;
  /** @internal */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** What `runFlowInProject` takes when the flow itself is given separately: everything but `flow` and `flowId` */
export type FlowRunOptions = Omit<RunFlowInProjectOptions, "flow" | "flowId">;
