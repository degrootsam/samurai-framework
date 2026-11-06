import {
  parseRunnerFlags,
  parseRunOverrides,
  type ParsedCommandLine,
} from "./args.js";
import type { AgentResult } from "../agent/index.js";
import type { Io } from "./io.js";

/** The agent entry, loaded when `generate` runs: it needs the optional packages `ai` and `zod` */
type AgentEntry = typeof import("../agent/index.js");

export interface GenerateDeps {
  loadAgent?: () => Promise<AgentEntry>;
}

const USAGE_LINE =
  'Usage: samurai generate "<goal>" --file <spec> [--new <title>] [--test <name|index>] [--url <url>] [--model <provider:name>] [--max-steps <n>] [--yes-origin <origin>] [--secret <NAME>] [--json]';

async function loadAgent(): Promise<AgentEntry> {
  try {
    return await import("../agent/index.js");
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_MODULE_NOT_FOUND")
      throw new Error(
        "samurai generate needs the packages ai and zod, and a provider package for your model; run: npm install ai zod @ai-sdk/anthropic (or @ai-sdk/openai, @ai-sdk/openai-compatible)",
      );
    throw error;
  }
}

function origin(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(
      `--yes-origin: "${raw}" is not a URL such as https://shop.example`,
    );
  }
}

/** The model the run uses: `--model`, else `SAMURAI_AI_MODEL`, else the config's `ai.model` */
async function chosenModel(
  agent: AgentEntry,
  flag: string | undefined,
  env: Io["env"],
) {
  const spec = flag ?? (await agent.defaultModelSpec(env));
  if (!spec)
    throw new Error(
      "No model: pass --model provider:name (anthropic, openai or openai-compatible), set SAMURAI_AI_MODEL, or set ai.model in samurai.config.ts",
    );
  return {
    spec,
    model: await agent.modelFromSpec(spec, { projectDir: process.cwd(), env }),
  };
}

/** `samurai generate "<goal>"`: lets the AI agent write a test and prints what it does. Returns the exit code */
export async function generateCommand(
  { values, positionals }: ParsedCommandLine,
  io: Io,
  deps: GenerateDeps = {},
): Promise<number> {
  const goal = positionals[0];
  if (!goal) throw new Error(`Which goal? ${USAGE_LINE}`);
  const files = values.file ?? [];
  if (files.length !== 1)
    throw new Error(`Give exactly one --file <spec>. ${USAGE_LINE}`);
  const maxSteps =
    values["max-steps"] === undefined ? undefined : Number(values["max-steps"]);
  if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1))
    throw new Error(
      `--max-steps must be a whole number from 1, got "${values["max-steps"]}"`,
    );
  const flags = parseRunnerFlags(values);
  if (flags.browsers && flags.browsers.length > 1)
    throw new Error("--browser: the agent uses one browser");
  const test =
    values.test === undefined
      ? undefined
      : /^\d+$/.test(values.test)
        ? Number(values.test)
        : values.test;
  const allowedOrigins = (values["yes-origin"] ?? []).map(origin);

  const agent = await (deps.loadAgent ?? loadAgent)();
  const { spec, model } = await chosenModel(agent, values.model, io.env);
  const json = values.json === true;
  if (!json)
    io.out(
      `Model ${spec.slice(0, spec.indexOf(":"))}: the pages the agent reads are sent to that provider.\n`,
    );

  const session = agent.runAgent({
    ...parseRunOverrides(values, io.env),
    model,
    goal,
    file: files[0]!,
    ...(test !== undefined && { test }),
    ...(values.new !== undefined && { create: values.new }),
    ...(values.url !== undefined && { url: values.url }),
    ...(flags.browsers && { browser: flags.browsers[0]! }),
    ...(flags.port !== undefined && { port: flags.port }),
    ...(flags.headless !== undefined && { headless: flags.headless }),
    ...(allowedOrigins.length > 0 && { allowedOrigins }),
    ...(values.secret && { secrets: values.secret }),
    ...(values["secret-field"] && { secretFields: values["secret-field"] }),
    ...(maxSteps !== undefined && { limits: { maxSteps } }),
    ...(io.signal && { signal: io.signal }),
  });

  let unanswerable: string | undefined;
  for await (const event of session.events) {
    if (json) io.out(`${JSON.stringify(event)}\n`);
    switch (event.type) {
      case "plan":
        if (!json) io.out(`${event.text}\n`);
        break;
      case "tool-call":
        if (!json) io.out(`  · ${event.tool} ${summaryOf(event.args)}\n`);
        break;
      case "step":
        if (!json && event.code !== undefined)
          io.out(
            `  ${event.event.op === "insert" ? "+" : "~"} ${event.code}\n`,
          );
        break;
      case "question": {
        const originQuestion = event.options?.join("/") === "allow/deny";
        if (io.prompt && !json) {
          io.out(
            `? ${event.question}${event.options ? ` (${event.options.join("/")})` : ""}\n`,
          );
          void io
            .prompt("> ")
            .then((answer) => session.answer(event.id, answer))
            .catch(() => undefined); // the run ended while the question was open
        } else if (originQuestion) {
          session.answer(event.id, "deny");
        } else {
          unanswerable = event.question;
          session.stop();
        }
        break;
      }
      case "ended":
        if (!json) summarise(io, event.result);
        break;
      default:
        break;
    }
  }
  if (unanswerable !== undefined)
    io.err(
      `The agent asked "${unanswerable}" and nobody can answer: stdin is not a terminal${json ? " (or --json is set)" : ""}. Run it in a terminal, or put the answer in the goal.\n`,
    );
  return (await session.result).reason === "finished" ? 0 : 1;
}

function summaryOf(args: unknown): string {
  const text = JSON.stringify(args ?? {});
  return text.length > 100 ? `${text.slice(0, 99)}…` : text;
}

const ENDINGS: Record<string, string> = {
  stopped: "Stopped.",
  "step-limit": "Stopped at the step limit (--max-steps).",
  "token-limit": "Stopped at the token limit.",
  "time-limit": "Stopped at the time limit.",
};

function summarise(io: Io, result: AgentResult): void {
  const base = `"${result.test}" has ${result.steps} ${result.steps === 1 ? "step" : "steps"} in ${result.file}.`;
  if (result.reason === "error")
    io.err(`\nThe run failed: ${result.error ?? "unknown error"}\n${base}\n`);
  else
    io.out(
      `\n${result.reason === "finished" ? "Done" : (ENDINGS[result.reason] ?? result.reason)} ${base}\n${result.summary ? `${result.summary}\n` : ""}`,
    );
  if (result.secrets.length > 0)
    io.out(
      `Set ${result.secrets.map((name) => `SAMURAI_SECRET_${name}`).join(", ")} (environment variable or .env.<environment>) before running it.\n`,
    );
  io.out(
    `${result.tokens} tokens used. Review the steps before you run the test.\n`,
  );
}
