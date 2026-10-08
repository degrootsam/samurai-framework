import path from "node:path";
import {
  parseCommandLine,
  parseRunnerFlags,
  parseRunOverrides,
} from "./args.js";
import { FlowReporter } from "./flow-reporter.js";
import type { Io } from "./main.js";
import { type FlowFile, type FlowProblem } from "../flows/core/index.js";
import {
  FLOW_SUFFIX,
  FlowCheckError,
  FlowReportBuilder,
  checkFlowInProject,
  flowsDir,
  listFlows,
  readFlow,
  readFlowPath,
  runFlowInProject,
  writeFlowReport,
} from "../flows/run/index.js";

export const FLOW_USAGE = `Usage:
  samurai flow list [--json]                    List the flows in ./flows
  samurai flow check [<flow>...] [options]      Check flows without running them (all flows when none is given)
  samurai flow run <flow>... [options]          Run flows, in the order given
  samurai flow run --all [options]              Run every flow in ./flows, in file name order

A flow is an id (flows/<id>.flow.json) or a path to a .flow.json file.

Options for check and run:
  --env <name>                Environment to use (or SAMURAI_ENV)
  --allow-unsupported         Skip nodes that can't run yet (HTTP request, ...) instead of refusing the flow
  --json                      Machine-readable output: JSON lines for run, one array for check and list

Options for run:
  --timeout <ms>              Time one test may take
  --expect-timeout <ms>       Time actions and assertions retry
  --headless, --no-headless   Run the browser without a window, or with one
  --port <n>                  Browser debugging port (default 9223)

Each run writes result/flows/<id>.json.
Exit code: 0 when every node that should run passed, 1 when a node failed or the run was cancelled,
2 for a usage, configuration or flow-file error, or a flow that has errors (nothing ran).
`;

class UsageError extends Error {}

type Problem = FlowProblem & { flow: string; key?: string; title?: string };

const describe = (flow: FlowFile, p: FlowProblem) => {
  const node = p.nodeId ? flow.nodes.find((n) => n.id === p.nodeId) : undefined;
  return {
    ...p,
    flow: flow.id,
    ...(node?.key && { key: node.key }),
    ...(node?.title && { title: node.title }),
  } as Problem;
};

function paintWith(io: Io) {
  return (code: number, text: string) =>
    io.color ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function problemLines(io: Io, problems: Problem[]): string {
  const paint = paintWith(io);
  return problems
    .map((p) => {
      const who = p.key
        ? `${p.key}${p.title && p.title !== p.key ? ` (${p.title})` : ""}: `
        : "";
      const mark =
        p.level === "error" ? paint(31, "✖ error  ") : paint(33, "! warning");
      return `  ${mark} ${who}${p.message}\n`;
    })
    .join("");
}

/** A flow is an id in ./flows, or a path to a .flow.json file */
async function load(projectDir: string, ref: string): Promise<FlowFile> {
  const isPath = /[\\/]/.test(ref) || ref.endsWith(".json");
  return isPath
    ? readFlowPath(path.resolve(projectDir, ref))
    : readFlow(projectDir, ref);
}

async function everyFlow(projectDir: string): Promise<string[]> {
  const ids = await listFlows(projectDir);
  if (ids.length === 0)
    throw new Error(
      `No flows: ${flowsDir(projectDir)} has no *${FLOW_SUFFIX} files.`,
    );
  return ids;
}

async function list(io: Io, json: boolean): Promise<number> {
  const projectDir = process.cwd();
  const rows: { id: string; name?: string; nodes?: number; error?: string }[] =
    [];
  for (const id of await listFlows(projectDir)) {
    try {
      const flow = await readFlow(projectDir, id);
      rows.push({ id, name: flow.name, nodes: flow.nodes.length });
    } catch (e) {
      rows.push({ id, error: (e as Error).message });
    }
  }
  if (json) io.out(`${JSON.stringify(rows, null, 2)}\n`);
  else if (rows.length === 0) io.out("No flows in ./flows\n");
  else
    for (const row of rows)
      io.out(
        row.error
          ? `${row.id}  (unreadable: ${row.error})\n`
          : `${row.id}  ${row.name}  (${row.nodes} ${row.nodes === 1 ? "node" : "nodes"})\n`,
      );
  return 0;
}

async function check(
  refs: string[],
  io: Io,
  options: {
    json: boolean;
    environment?: string;
    unsupported: "fail" | "skip";
  },
): Promise<number> {
  const projectDir = process.cwd();
  const targets = refs.length ? refs : await everyFlow(projectDir);
  const all: Problem[] = [];
  let code = 0;
  for (const ref of targets) {
    let flow: FlowFile;
    try {
      flow = await load(projectDir, ref);
    } catch (e) {
      io.err(`${(e as Error).message}\n`);
      code = 2;
      continue;
    }
    const result = await checkFlowInProject({
      projectDir,
      flow,
      unsupported: options.unsupported,
      ...(options.environment && { environment: options.environment }),
    });
    const problems = result.problems.map((p) => describe(result.flow, p));
    all.push(...problems);
    if (code === 0 && problems.some((p) => p.level === "error")) code = 1;
    if (!options.json) {
      io.out(
        problems.length === 0
          ? `${flow.id}: ok\n`
          : `${flow.id}:\n${problemLines(io, problems)}`,
      );
    }
  }
  if (options.json) io.out(`${JSON.stringify(all, null, 2)}\n`);
  return code;
}

async function run(
  refs: string[],
  io: Io,
  options: {
    json: boolean;
    environment?: string;
    unsupported: "fail" | "skip";
    run: Omit<Parameters<typeof runFlowInProject>[0], "flow" | "flowId">;
  },
): Promise<number> {
  const projectDir = process.cwd();
  const flows: FlowFile[] = [];
  for (const ref of refs) flows.push(await load(projectDir, ref));

  const refuse = (problems: FlowProblem[], flow: FlowFile): number => {
    const described = problems.map((p) => describe(flow, p));
    if (options.json) io.out(`${JSON.stringify(described, null, 2)}\n`);
    else
      io.err(
        `${flow.id} can't run:\n${problemLines(io, described)}Nothing was run.\n`,
      );
    return 2;
  };

  // Several flows: refuse them all before the first one runs
  if (flows.length > 1) {
    for (const flow of flows) {
      const { problems } = await checkFlowInProject({
        projectDir,
        flow,
        unsupported: options.unsupported,
        ...(options.environment && { environment: options.environment }),
      });
      const errors = problems.filter((p) => p.level === "error");
      if (errors.length) return refuse(errors, flow);
    }
  }

  let code = 0;
  for (const flow of flows) {
    if (io.signal?.aborted) {
      code = 1;
      break;
    }
    const builder = new FlowReportBuilder(flow);
    const human = options.json
      ? undefined
      : new FlowReporter({ flow, write: io.out, color: io.color });
    if (flows.indexOf(flow) > 0 && !options.json) io.out("\n");
    let summary;
    try {
      summary = await runFlowInProject({
        ...options.run,
        projectDir,
        flow,
        unsupported: options.unsupported,
        ...(io.signal && { signal: io.signal }),
        onEvent: (event) => {
          builder.handle(event);
          if (options.json) io.out(`${JSON.stringify(event)}\n`);
          else human?.handle(event);
        },
      });
    } catch (e) {
      if (e instanceof FlowCheckError) return refuse(e.problems, flow);
      throw e;
    }
    const file = await writeFlowReport(projectDir, builder.finish(summary));
    if (!options.json)
      io.out(`Report: ${path.relative(projectDir, file) || file}\n`);
    if (summary.status !== "passed") code = 1;
  }
  return code;
}

/** `samurai flow ...`: `argv` is what follows `flow`. Returns the exit code */
export async function flowCommand(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseCommandLine(argv);
  const [sub, ...refs] = positionals;
  const unsupported = values["allow-unsupported"] ? "skip" : "fail";
  const json = values.json === true;
  const overrides = parseRunOverrides(argv, io.env);
  try {
    if (sub === "list" && refs.length === 0) return await list(io, json);
    if (sub === "check")
      return await check(refs, io, {
        json,
        unsupported,
        ...(overrides.environment && { environment: overrides.environment }),
      });
    if (sub === "run") {
      if (values.all && refs.length > 0)
        throw new UsageError("Give flows or --all, not both.");
      if (!values.all && refs.length === 0)
        throw new UsageError("Which flow? Give a flow or --all.");
      const flags = parseRunnerFlags(argv);
      const targets = values.all ? await everyFlow(process.cwd()) : refs;
      return await run(targets, io, {
        json,
        unsupported,
        ...(overrides.environment && { environment: overrides.environment }),
        run: {
          ...overrides,
          ...(flags.headless !== undefined && { headless: flags.headless }),
          ...(flags.port !== undefined && { port: flags.port }),
        },
      });
    }
    throw new UsageError(
      sub === undefined
        ? "Which flow command?"
        : `Unknown flow command "${[sub, ...refs].join(" ")}"`,
    );
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`${e.message}\n\n${FLOW_USAGE}`);
      return 2;
    }
    throw e;
  }
}
