import type { PlanResult } from "../agent/index.js";
import {
  endingOf,
  followRun,
  prepareAgentRun,
  type AgentCommandDeps,
} from "./agent-run.js";
import type { ParsedCommandLine } from "./args.js";
import type { Io } from "./io.js";

export type PlanDeps = AgentCommandDeps;

const USAGE_LINE =
  'Usage: samurai plan "<goal>" [--out <plan.md>] [--force] [--url <url>] [--model <provider:name>] [--max-steps <n>] [--yes-origin <origin>] [--secret <NAME>] [--json]';

/** `samurai plan "<goal>"`: without `--out` the plan goes to `<plansDir>/<slug-of-goal>.plan.md`. Lets the AI agent explore the page and write a test plan, without submitting anything */
export async function planCommand(
  parsed: ParsedCommandLine,
  io: Io,
  deps: PlanDeps = {},
): Promise<number> {
  const { values, positionals } = parsed;
  const goal = positionals[0];
  if (!goal) throw new Error(`Which goal? ${USAGE_LINE}`);
  const { agent, model, options } = await prepareAgentRun(
    parsed,
    io,
    deps,
    "plan",
  );
  const out =
    values.out === undefined || values.out === ""
      ? await agent.defaultPlanFile(goal)
      : values.out;
  if (values.out === undefined && values.json !== true)
    io.out(`The plan will be written to ${out}\n`);
  const session = agent.runPlan({
    ...options,
    model,
    goal,
    out,
    ...(values.force === true && { force: true }),
  });
  return followRun(session, io, values.json === true, (result) =>
    summarise(io, result),
  );
}

function summarise(io: Io, result: PlanResult): void {
  const base = `The plan in ${result.file} has ${result.steps} ${result.steps === 1 ? "step" : "steps"}.`;
  if (result.reason === "error")
    io.err(`\nThe run failed: ${result.error ?? "unknown error"}\n${base}\n`);
  else
    io.out(
      `\n${endingOf(result.reason)} ${base}\n${result.summary ? `${result.summary}\n` : ""}`,
    );
  io.out(
    `${result.tokens} tokens used. Read the plan, fix what is wrong, then: samurai generate "<goal>" --plan ${result.file} --file <spec>\n`,
  );
}
