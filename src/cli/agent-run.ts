import {
  parseRunnerFlags,
  parseRunOverrides,
  type ParsedCommandLine,
} from "./args.js";
import type { AgentResult, AgentSession } from "../agent/index.js";
import type { Io } from "./io.js";

/** The agent entry, loaded when `generate` or `plan` runs: it needs the optional packages `ai` and `zod` */
export type AgentEntry = typeof import("../agent/index.js");

export interface AgentCommandDeps {
  loadAgent?: () => Promise<AgentEntry>;
}

async function loadAgentEntry(command: string): Promise<AgentEntry> {
  try {
    return await import("../agent/index.js");
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_MODULE_NOT_FOUND")
      throw new Error(
        `samurai ${command} needs the packages ai and zod, and a provider package for your model; run: npm install ai zod @ai-sdk/anthropic (or @ai-sdk/openai, @ai-sdk/openai-compatible)`,
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

/**
 * What `generate` and `plan` share: the flags both read (browser, origins, secrets, limits, ...), the model and
 * the notice of which provider receives the pages. Throws a usage error for a bad flag.
 */
export async function prepareAgentRun(
  { values }: ParsedCommandLine,
  io: Io,
  deps: AgentCommandDeps,
  command: string,
) {
  const maxSteps =
    values["max-steps"] === undefined ? undefined : Number(values["max-steps"]);
  if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1))
    throw new Error(
      `--max-steps must be a whole number from 1, got "${values["max-steps"]}"`,
    );
  const flags = parseRunnerFlags(values);
  if (flags.browsers && flags.browsers.length > 1)
    throw new Error("--browser: the agent uses one browser");
  const allowedOrigins = (values["yes-origin"] ?? []).map(origin);
  const agent = await (deps.loadAgent ?? (() => loadAgentEntry(command)))();
  const { spec, model } = await chosenModel(agent, values.model, io.env);
  if (values.json !== true)
    io.out(
      `Model ${spec.slice(0, spec.indexOf(":"))}: the pages the agent reads are sent to that provider.\n`,
    );
  return {
    agent,
    model,
    options: {
      ...parseRunOverrides(values, io.env),
      ...(values.url !== undefined && { url: values.url }),
      ...(flags.browsers && { browser: flags.browsers[0]! }),
      ...(flags.port !== undefined && { port: flags.port }),
      ...(flags.headless !== undefined && { headless: flags.headless }),
      ...(allowedOrigins.length > 0 && { allowedOrigins }),
      ...(values.secret && { secrets: values.secret }),
      ...(values["secret-field"] && { secretFields: values["secret-field"] }),
      ...(maxSteps !== undefined && { limits: { maxSteps } }),
      ...(io.signal && { signal: io.signal }),
    },
  };
}

function summaryOf(args: unknown): string {
  const text = JSON.stringify(args ?? {});
  return text.length > 100 ? `${text.slice(0, 99)}…` : text;
}

/**
 * Prints a run's events (or each as a JSON line) and answers its questions in the terminal. Returns the exit code:
 * 0 for a run that finished, 1 for any other end. `summarise` prints the closing text of the command.
 */
export async function followRun(
  session: Pick<AgentSession, "events" | "answer" | "stop"> & {
    result: Promise<{ reason: string }>;
  },
  io: Io,
  json: boolean,
  summarise: (result: AgentResult) => void,
): Promise<number> {
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
      case "plan-step":
        if (!json) io.out(`  + ${event.n}. ${event.text}\n`);
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
        if (!json) summarise(event.result);
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

const ENDINGS: Record<string, string> = {
  stopped: "Stopped.",
  "step-limit": "Stopped at the step limit (--max-steps).",
  "token-limit": "Stopped at the token limit.",
  "time-limit": "Stopped at the time limit.",
};

/** The opening words of the closing text: "Done" or how the run stopped */
export function endingOf(reason: string): string {
  return reason === "finished" ? "Done" : (ENDINGS[reason] ?? reason);
}
