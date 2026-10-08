import path from "node:path";
import { loadConfig, setActiveProject } from "../../config/config.js";
import {
  checkFlow,
  withKeys,
  type FlowFile,
  type FlowProblem,
} from "../core/index.js";
import {
  DEFAULT_SRC_DIR,
  resolveGroups,
  testId,
  toPosix,
} from "../../runner/groups.js";
import { withProject, type ProjectOptions } from "../../runner/project.js";
import { runTests } from "../../runner/run.js";
import TestRunner from "../../runner/test-runner.js";
import type { SamuraiTestConfig } from "../../types/config.js";
import type { FlowEvent, FlowSummary, NodeTest } from "./events.js";
import { readFlow } from "./files.js";
import { HANDLERS } from "./handlers/index.js";
import { runFlow } from "./run.js";

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
  /** @internal Replaces the runner of each Test and Group node (tests) */
  testRunner?: typeof runTests;
  /** @internal */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Reads the project's config without keeping the project active (`withProject` is one at a time) */
async function configOf(options: RunFlowInProjectOptions) {
  if (options.config) return options.config;
  setActiveProject({ dir: path.resolve(options.projectDir ?? process.cwd()) });
  try {
    return await loadConfig();
  } finally {
    setActiveProject(undefined);
  }
}

/** The environment: the option, else the flow's `envDefault` (when the project has it), else the config's default, else the first, else "default" */
export function chooseEnvironment(
  config: SamuraiTestConfig,
  flow: FlowFile,
  option?: string,
): string {
  const names = Object.keys(config.environments ?? {});
  if (option) return option;
  if (flow.envDefault && names.includes(flow.envDefault))
    return flow.envDefault;
  return config.defaultEnvironment ?? names[0] ?? "default";
}

/** What the project says about a flow: its environment, tests and groups */
async function prepare(options: RunFlowInProjectOptions) {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  if (!options.flow && !options.flowId)
    throw new Error("Give a flow or a flowId.");
  const flow = withKeys(
    options.flow ?? (await readFlow(projectDir, options.flowId!)),
  );
  const unsupported = options.unsupported ?? "fail";

  // Config, environment, tests and groups (one project session, then it ends)
  const config = await configOf({ ...options, projectDir });
  const name = chooseEnvironment(config, flow, options.environment);
  const environment = {
    name,
    variables: {
      ...(Object.prototype.hasOwnProperty.call(config.environments ?? {}, name)
        ? config.environments![name]!.variables
        : {}),
    },
  };
  const srcDir = path.resolve(projectDir, config.srcDir ?? DEFAULT_SRC_DIR);
  const { tests, groups } = await withProject(
    {
      projectDir,
      config,
      ...(options.dataDir !== undefined && { dataDir: options.dataDir }),
      environment: name,
    },
    async (run) => {
      const found = await (await TestRunner.init(run)).register();
      const tests = found.map((t) => ({
        id: testId(toPosix(path.relative(srcDir, t.file)), t.name),
        file: t.file,
        name: t.name,
        relative: toPosix(path.relative(srcDir, t.file)),
      }));
      const groups = resolveGroups(
        config,
        tests.map((t) => ({ file: t.relative, name: t.name })),
        projectDir,
        srcDir,
      );
      return { tests, groups };
    },
  );
  const problems = checkFlow(flow, {
    tests: tests.map((t) => t.id),
    groups: groups.map((g) => g.name),
    environment,
    handled: new Set(Object.keys(HANDLERS)),
    unsupported,
  });
  return {
    projectDir,
    flow,
    unsupported,
    config,
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

/**
 * Checks and runs a flow of a project: loads its config, lists its tests and groups, refuses to start
 * when `checkFlow` finds errors (`FlowCheckError`), then walks the flow; each Test and Group node runs
 * its tests through `runTests`, one after the other. One at a time per process.
 */
export async function runFlowInProject(
  options: RunFlowInProjectOptions,
): Promise<FlowSummary> {
  const {
    projectDir,
    flow,
    unsupported,
    config,
    name,
    environment,
    tests,
    groups,
    problems,
  } = await prepare(options);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) throw new FlowCheckError(errors);

  // Phase 3: walk it
  const byId = new Map(tests.map((t) => [t.id, t]));
  const nodeTests: Record<string, NodeTest[]> = {};
  for (const node of flow.nodes) {
    const ids =
      node.kind === "test"
        ? [node.ref?.testId ?? ""]
        : node.kind === "group"
          ? (groups.find((g) => g.name === node.ref?.group)?.testIds ?? [])
          : undefined;
    if (!ids) continue;
    nodeTests[node.id] = ids.flatMap((id) => {
      const t = byId.get(id);
      return t ? [{ file: t.file, name: t.name }] : [];
    });
  }

  const run = options.testRunner ?? runTests;
  return runFlow({
    flow,
    nodeTests,
    environment,
    ...(options.signal && { signal: options.signal }),
    ...(options.onEvent && { onEvent: options.onEvent }),
    ...(options.sleep && { sleep: options.sleep }),
    unsupported,
    runTests: async ({ tests, onEvent, signal }) => {
      const summary = await run({
        projectDir,
        config,
        ...(options.dataDir !== undefined && { dataDir: options.dataDir }),
        // The environment the expressions see, whenever the project defines it
        ...(Object.prototype.hasOwnProperty.call(
          config.environments ?? {},
          name,
        )
          ? { environment: name }
          : {}),
        ...(options.headless !== undefined && { headless: options.headless }),
        ...(options.timeout !== undefined && { timeout: options.timeout }),
        ...(options.expectTimeout !== undefined && {
          expectTimeout: options.expectTimeout,
        }),
        ...(options.port !== undefined && { port: options.port }),
        files: [...new Set(tests.map((t) => t.file))],
        testNames: tests.map((t) => t.name),
        reportPath: false,
        signal,
        onEvent,
      });
      if (signal.aborted) return "cancelled";
      return summary.status === "success" ? "passed" : "failed";
    },
  });
}
