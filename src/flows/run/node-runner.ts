import path from "node:path";
import type { RunEvent } from "../../runner/reporter.js";
import type { runTests } from "../../runner/run.js";
import type { WorkerPool } from "../../runner/worker-pool.js";
import type { SupportedBrowser } from "../../types/browser.js";
import type { SamuraiTestConfig } from "../../types/config.js";
import { inNodeFolder, nodeFolder } from "./node-folder.js";
import { itemsOf, runOnPool } from "./node-pool.js";
import type { RunFlowInProjectOptions } from "./project-options.js";
import type { RunFlowOptions } from "./run.js";

/** What every node's tests share in a project's flow run */
export interface NodeRunnerInput {
  projectDir: string;
  config: SamuraiTestConfig;
  options: RunFlowInProjectOptions;
  /** The environment the expressions see, when the project defines it */
  environment?: string;
  retries: number;
  run: typeof runTests;
  /** The run's worker pool, when `workers` is above 1 */
  pool?: Pick<WorkerPool, "run">;
}

/**
 * How a Test or Group node runs its tests in one browser's run of a project's flow: on the pool, else through
 * `runTests` in this process. With an `outputDir`, each node writes to its own `nodeFolder` in it, and its
 * screenshot paths are made relative to `outputDir`.
 */
export function nodeRunner(
  input: NodeRunnerInput,
  browser: SupportedBrowser,
): RunFlowOptions["runTests"] {
  const { projectDir, config, options, environment, retries, run, pool } =
    input;
  return async ({ nodeId, tests, onEvent: onTestEvent, signal }) => {
    // Each node gets a folder of its own per browser: the same test in two nodes would overwrite its screenshots
    const folder = nodeFolder(nodeId, browser);
    const outputDir =
      options.outputDir !== undefined
        ? path.join(options.outputDir, ...folder.split("/"))
        : undefined;
    // Screenshot paths come relative to the node's folder: make them relative to outputDir
    const onEvent =
      outputDir !== undefined
        ? (e: RunEvent) => onTestEvent(inNodeFolder(e, folder))
        : onTestEvent;
    if (pool)
      return runOnPool(
        pool,
        itemsOf(tests, browser, outputDir),
        onEvent,
        signal,
      );
    const summary = await run({
      projectDir,
      config,
      ...(options.dataDir !== undefined && { dataDir: options.dataDir }),
      ...(environment !== undefined && { environment }),
      ...(options.headless !== undefined && { headless: options.headless }),
      ...(options.timeout !== undefined && { timeout: options.timeout }),
      ...(options.expectTimeout !== undefined && {
        expectTimeout: options.expectTimeout,
      }),
      ...(options.port !== undefined && { port: options.port }),
      ...(retries > 0 && { retries }),
      browsers: [browser],
      files: [...new Set(tests.map((t) => t.file))],
      testNames: tests.map((t) => t.name),
      reportPath: false,
      ...(outputDir !== undefined && { outputDir }),
      signal,
      onEvent,
    });
    if (signal.aborted) return "cancelled";
    return summary.status === "success" ? "passed" : "failed";
  };
}
