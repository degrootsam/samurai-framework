import type { AgentResult } from "../agent/index.js";
import {
  endingOf,
  followRun,
  prepareAgentRun,
  type AgentCommandDeps,
} from "./agent-run.js";
import type { ParsedCommandLine } from "./args.js";
import type { Io } from "./io.js";

export type GenerateDeps = AgentCommandDeps;

const USAGE_LINE =
  'Usage: samurai generate "<goal>" --file <spec> [--new <title>] [--test <name|index>] [--plan <plan.md>] [--url <url>] [--model <provider:name>] [--max-steps <n>] [--yes-origin <origin>] [--secret <NAME>] [--json]';

/** `samurai generate "<goal>"`: lets the AI agent write a test and prints what it does. Returns the exit code */
export async function generateCommand(
  parsed: ParsedCommandLine,
  io: Io,
  deps: GenerateDeps = {},
): Promise<number> {
  const { values, positionals } = parsed;
  const goal = positionals[0];
  if (!goal) throw new Error(`Which goal? ${USAGE_LINE}`);
  const files = values.file ?? [];
  if (files.length !== 1)
    throw new Error(`Give exactly one --file <spec>. ${USAGE_LINE}`);
  const test =
    values.test === undefined
      ? undefined
      : /^\d+$/.test(values.test)
        ? Number(values.test)
        : values.test;

  const { agent, model, options } = await prepareAgentRun(
    parsed,
    io,
    deps,
    "generate",
  );
  const plan =
    values.plan === undefined ? undefined : readPlanFlag(agent, values.plan);
  const session = agent.runAgent({
    ...options,
    model,
    goal,
    file: files[0]!,
    ...(test !== undefined && { test }),
    ...(values.new !== undefined && { create: values.new }),
    ...(plan !== undefined && { plan }),
  });
  return followRun(session, io, values.json === true, (result) =>
    summarise(io, result),
  );
}

/** The text of `--plan <file>`; a file that cannot be used is a usage error that names it */
function readPlanFlag(
  agent: { readPlan(file: string): string },
  file: string,
): string {
  try {
    return agent.readPlan(file);
  } catch (error) {
    throw new Error(
      `--plan: ${(error as Error).message.replace(/^readPlan\(\): /, "")}`,
    );
  }
}

function summarise(io: Io, result: AgentResult): void {
  const base = `"${result.test}" has ${result.steps} ${result.steps === 1 ? "step" : "steps"} in ${result.file}.`;
  if (result.reason === "error")
    io.err(`\nThe run failed: ${result.error ?? "unknown error"}\n${base}\n`);
  else
    io.out(
      `\n${endingOf(result.reason)} ${base}\n${result.summary ? `${result.summary}\n` : ""}`,
    );
  if (result.secrets.length > 0)
    io.out(
      `Set ${result.secrets.map((name) => `SAMURAI_SECRET_${name}`).join(", ")} (environment variable or .env.<environment>) before running it.\n`,
    );
  io.out(
    `${result.tokens} tokens used. Review the steps before you run the test.\n`,
  );
}
