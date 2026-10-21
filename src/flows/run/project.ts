import path from "node:path";
import { cleanName } from "../../browser/evidence.js";
import { DEFAULT_SRC_DIR } from "../../config/defaults.js";
import { projectConfig } from "../../config/config.js";
import {
  checkFlow,
  withKeys,
  type FlowFile,
  type FlowProblem,
} from "../core/index.js";
import {
  realPath,
  resolveGroups,
  testId,
  toPosix,
  type ResolvedGroup,
} from "../../runner/groups.js";
import logger, { keepLogFiles } from "../../logger/index.js";
import { resolveRetries } from "../../runner/retries-option.js";
import { resolveWorkers } from "../../config/workers-option.js";
import { withProject } from "../../runner/project.js";
import { browsersFor } from "../../config/browsers-for.js";
import { DEFAULT_PORT } from "../../runner/ports.js";
import { runTests } from "../../runner/run.js";
import TestRunner from "../../runner/test-runner.js";
import { WorkerPool } from "../../runner/worker-pool.js";
import { processWorkerFactory } from "../../runner/worker-process.js";
import type { SamuraiTestConfig } from "../../types/config.js";
import type { FlowSummary, NodeTest } from "./events.js";
import { readFlow } from "./files.js";
import { itemsOf, runOnPool } from "./node-pool.js";
import {
  FlowCheckError,
  type FlowRunOptions,
  type RunFlowInProjectOptions,
} from "./project-options.js";
import { projectSteps, type StepSet } from "../steps/set.js";
import { HANDLERS } from "./handlers/index.js";
import { runFlow } from "./run.js";
import type { SupportedBrowser } from "../../types/browser.js";

export { FlowCheckError };
export type { FlowRunOptions, RunFlowInProjectOptions };

/** Whether the project's config defines an environment of this name */
function hasEnvironment(config: SamuraiTestConfig, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(config.environments ?? {}, name);
}

/** The environment: the option, else the flow's `envDefault` (when the project has it), else the config's default, else the first, else "default" */
export function chooseEnvironment(
  config: SamuraiTestConfig,
  flow: FlowFile,
  option?: string,
): string {
  if (option) return option;
  const names = Object.keys(config.environments ?? {});
  if (flow.envDefault && names.includes(flow.envDefault))
    return flow.envDefault;
  return config.defaultEnvironment ?? names[0] ?? "default";
}

/** A test of the project as flows see it */
interface ProjectTest {
  id: string;
  file: string;
  name: string;
  /** The spec file relative to `srcDir`, with `/` separators */
  relative: string;
}

/** What the project says about a flow: its environment, tests and groups, and what is wrong with the flow */
interface PreparedFlow {
  projectDir: string;
  flow: FlowFile;
  unsupported: "fail" | "skip";
  config: SamuraiTestConfig;
  steps: StepSet;
  name: string;
  environment: {
    name: string;
    variables: Record<string, string | number | boolean>;
  };
  tests: ProjectTest[];
  groups: ResolvedGroup[];
  problems: FlowProblem[];
}

/** The tests, and the browsers, of each Test and Group node of a flow; a Test node uses the project's browsers */
export function nodeTestsOf(
  flow: FlowFile,
  tests: Pick<ProjectTest, "id" | "file" | "name">[],
  groups: Pick<ResolvedGroup, "name" | "testIds" | "browsers">[],
): {
  nodeTests: Record<string, NodeTest[]>;
  nodeBrowsers: Record<string, SupportedBrowser[]>;
} {
  const byId = new Map(tests.map((t) => [t.id, t]));
  const nodeTests: Record<string, NodeTest[]> = {};
  const nodeBrowsers: Record<string, SupportedBrowser[]> = {};
  for (const node of flow.nodes) {
    const group =
      node.kind === "group"
        ? groups.find((g) => g.name === node.ref?.group)
        : undefined;
    const ids =
      node.kind === "test"
        ? [node.ref?.testId ?? ""]
        : node.kind === "group"
          ? (group?.testIds ?? [])
          : undefined;
    if (!ids) continue;
    if (group) nodeBrowsers[node.id] = group.browsers;
    nodeTests[node.id] = ids.flatMap((id) => {
      const t = byId.get(id);
      return t ? [{ file: t.file, name: t.name }] : [];
    });
  }
  return { nodeTests, nodeBrowsers };
}

async function prepare(
  options: RunFlowInProjectOptions,
): Promise<PreparedFlow> {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  if (!options.flow && !options.flowId)
    throw new Error("Give a flow or a flowId.");
  const flow = withKeys(
    options.flow ?? (await readFlow(projectDir, options.flowId!)),
  );
  const unsupported = options.unsupported ?? "fail";

  // Config, environment, tests and groups (one project session, then it ends)
  const config = await projectConfig({ ...options, projectDir });
  const steps = await projectSteps({ config });
  const name = chooseEnvironment(config, flow, options.environment);
  const environment = {
    name,
    variables: {
      ...(hasEnvironment(config, name)
        ? config.environments![name]!.variables
        : {}),
    },
  };
  // Real paths, like the registered test files
  const realDir = realPath(projectDir);
  const srcDir = realPath(
    path.resolve(realDir, config.srcDir ?? DEFAULT_SRC_DIR),
  );
  const { tests, groups } = await withProject(
    {
      projectDir,
      config,
      ...(options.dataDir !== undefined && { dataDir: options.dataDir }),
      environment: name,
    },
    async (run) => {
      const { tests: found } = await (await TestRunner.init(run)).list();
      const tests = found.map((t) => ({
        id: testId(toPosix(path.relative(srcDir, t.file)), t.name),
        file: t.file,
        name: t.name,
        relative: toPosix(path.relative(srcDir, t.file)),
      }));
      const groups = resolveGroups(
        config,
        tests.map((t) => ({ file: t.relative, name: t.name })),
        realDir,
        srcDir,
      );
      return { tests, groups };
    },
  );
  const problems = checkFlow(flow, {
    tests: tests.map((t) => t.id),
    groups: groups.map((g) => g.name),
    environment,
    handled: new Set([
      ...Object.keys(HANDLERS),
      ...Object.keys(steps.handlers),
    ]),
    unsupported,
    nodes: steps.nodes,
  });
  return {
    projectDir,
    flow,
    unsupported,
    config,
    steps,
    name,
    environment,
    tests,
    groups,
    problems,
  };
}

/**
 * Checks a flow against the project without running it: its tests, groups and environment
 * variables, and which kinds can run. Returns the flow (with keys) and every problem, warnings included.
 */
export async function checkFlowInProject(
  options: Pick<
    RunFlowInProjectOptions,
    | "flow"
    | "flowId"
    | "projectDir"
    | "config"
    | "dataDir"
    | "environment"
    | "unsupported"
  >,
): Promise<{ flow: FlowFile; problems: FlowProblem[] }> {
  const { flow, problems } = await prepare(options);
  return { flow, problems };
}

async function walkFlowInProject(
  options: RunFlowInProjectOptions,
): Promise<FlowSummary> {
  const {
    projectDir,
    flow,
    unsupported,
    config,
    steps,
    name,
    environment,
    tests,
    groups,
    problems,
  } = await prepare(options);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) throw new FlowCheckError(errors);

  const { nodeTests, nodeBrowsers } = nodeTestsOf(flow, tests, groups);
  const run = options.testRunner ?? runTests;
  // An injected runner (tests) stays in this process unless the workers are asked for
  const asked =
    options.workers !== undefined ||
    Boolean(options.workersEnv) ||
    config.workers !== undefined;
  let workers =
    options.testRunner && options.workers === undefined
      ? 1
      : resolveWorkers({
          flag: options.workers,
          env: options.workersEnv,
          config: config.workers,
        });
  // A worker reads `samurai.config.ts` from the project folder: a config given as an object stays in this process
  if (options.config !== undefined && !options.createPool && workers > 1) {
    if (asked)
      logger.warn(
        "workers needs samurai.config.ts in the project folder; running on one worker",
      );
    workers = 1;
  }
  const files = [
    ...new Set(
      Object.values(nodeTests).flatMap((list) => list.map((t) => t.file)),
    ),
  ];
  // A failing test is run again as often as the project says, in a node as in a plain run
  const retries = resolveRetries({
    flag: options.retries,
    env: options.retriesEnv,
    config: config.retries,
  });
  // One pool for the whole run: the nodes, and the branches of a Parallel node, share its workers
  const pool =
    workers > 1
      ? (options.createPool ?? ((o) => new WorkerPool(o)))({
          workers,
          factory: processWorkerFactory(),
          init: {
            projectDir,
            ...(options.dataDir !== undefined && { dataDir: options.dataDir }),
            ...(hasEnvironment(config, name) && { environment: name }),
            ...(options.timeout !== undefined && { timeout: options.timeout }),
            ...(options.expectTimeout !== undefined && {
              expectTimeout: options.expectTimeout,
            }),
            ...(options.headless !== undefined && {
              headless: options.headless,
            }),
            files,
            basePort: options.port ?? DEFAULT_PORT,
            ...(retries > 0 && { retries }),
          },
        })
      : undefined;
  try {
    return await runFlow({
      flow,
      nodeTests,
      nodeBrowsers,
      environment,
      ...(options.signal && { signal: options.signal }),
      ...(options.onEvent && { onEvent: options.onEvent }),
      ...(options.sleep && { sleep: options.sleep }),
      unsupported,
      handlers: { ...HANDLERS, ...steps.handlers },
      nodes: steps.nodes,
      runTests: async ({ nodeId, tests, onEvent, signal, browsers }) => {
        // Each node gets a folder of its own: the same test in two nodes would overwrite its screenshots
        const outputDir =
          options.outputDir !== undefined
            ? path.join(options.outputDir, "nodes", cleanName(nodeId))
            : undefined;
        if (pool)
          return runOnPool(
            pool,
            itemsOf(
              tests,
              browsers ?? browsersFor({ project: config.browsers }),
              outputDir,
            ),
            onEvent,
            signal,
          );
        const summary = await run({
          projectDir,
          config,
          ...(options.dataDir !== undefined && { dataDir: options.dataDir }),
          // The environment the expressions see, whenever the project defines it
          ...(hasEnvironment(config, name) ? { environment: name } : {}),
          ...(options.headless !== undefined && { headless: options.headless }),
          ...(options.timeout !== undefined && { timeout: options.timeout }),
          ...(options.expectTimeout !== undefined && {
            expectTimeout: options.expectTimeout,
          }),
          ...(options.port !== undefined && { port: options.port }),
          ...(retries > 0 && { retries }),
          ...(browsers && { browsers }),
          files: [...new Set(tests.map((t) => t.file))],
          testNames: tests.map((t) => t.name),
          reportPath: false,
          ...(outputDir !== undefined && { outputDir }),
          signal,
          onEvent,
        });
        if (signal.aborted) return "cancelled";
        return summary.status === "success" ? "passed" : "failed";
      },
    });
  } finally {
    await pool?.dispose();
  }
}

/**
 * Checks and runs a flow of a project: loads its config, lists its tests and groups, refuses to start
 * when `checkFlow` finds errors (`FlowCheckError`), then walks the flow; each Test and Group node runs
 * its tests through `runTests`, one after the other, or on one shared worker pool when `workers` is above 1.
 * One at a time per process.
 */
export async function runFlowInProject(
  options: RunFlowInProjectOptions,
): Promise<FlowSummary> {
  // One log for the whole run, across the project sessions it opens one after the other
  const releaseLogs = keepLogFiles(
    path.resolve(options.projectDir ?? process.cwd()),
  );
  try {
    return await walkFlowInProject(options);
  } finally {
    releaseLogs();
  }
}
