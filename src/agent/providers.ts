import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readConfig } from "../config/config.js";
import { assertModelObject, type AgentModel } from "./model.js";

/** The model cannot be set up: a usage or configuration problem, with the fix in the message */
export class ModelSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelSetupError";
  }
}

interface Provider {
  /** The package that has to be installed in the project */
  pkg: string;
  /** The environment variable of the key, `required` when the provider does not work without one */
  key: { env: string; required: boolean };
  /** Name of the factory the package exports */
  factory: string;
}

const PROVIDERS: Record<string, Provider> = {
  anthropic: {
    pkg: "@ai-sdk/anthropic",
    key: { env: "ANTHROPIC_API_KEY", required: true },
    factory: "createAnthropic",
  },
  openai: {
    pkg: "@ai-sdk/openai",
    key: { env: "OPENAI_API_KEY", required: true },
    factory: "createOpenAI",
  },
  "openai-compatible": {
    pkg: "@ai-sdk/openai-compatible",
    key: { env: "SAMURAI_AI_API_KEY", required: false },
    factory: "createOpenAICompatible",
  },
};

/** The providers `--model` names, for messages */
const NAMES = Object.keys(PROVIDERS).join(", ");

export interface ModelEnvironment {
  /** The project folder: the provider package is loaded from its `node_modules` */
  projectDir: string;
  env: Partial<NodeJS.ProcessEnv>;
}

/** `provider:name` split in two; throws for anything else */
function parseSpec(spec: string): { provider: Provider; name: string } {
  const at = spec.indexOf(":");
  const provider = at > 0 ? PROVIDERS[spec.slice(0, at)] : undefined;
  const name = at > 0 ? spec.slice(at + 1).trim() : "";
  if (!provider || name === "")
    throw new ModelSetupError(
      `--model must look like provider:name with a provider of ${NAMES}, for example anthropic:claude-sonnet-4-5 (got "${spec}")`,
    );
  return { provider, name };
}

async function loadProvider(
  provider: Provider,
  projectDir: string,
): Promise<Record<string, unknown>> {
  let file: string;
  try {
    file = createRequire(path.join(projectDir, "package.json")).resolve(
      provider.pkg,
    );
  } catch {
    throw new ModelSetupError(
      `the provider package ${provider.pkg} is not installed in this project; run: npm install ${provider.pkg} ai zod`,
    );
  }
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}

/**
 * Builds the model object a `provider:name` pair stands for, with the provider package loaded from the user's
 * project (the framework depends on none). The key comes from the environment (`ANTHROPIC_API_KEY`,
 * `OPENAI_API_KEY`, or `SAMURAI_AI_API_KEY` for `openai-compatible`, whose endpoint is `SAMURAI_AI_BASE_URL`);
 * it is never part of a message.
 */
export async function modelFromSpec(
  spec: string,
  { projectDir, env }: ModelEnvironment,
): Promise<AgentModel> {
  const { provider, name } = parseSpec(spec);
  const apiKey = env[provider.key.env];
  if (provider.key.required && !apiKey)
    throw new ModelSetupError(
      `${provider.key.env} is not set; set it to your ${spec.slice(0, spec.indexOf(":"))} API key`,
    );
  const compatible = provider.pkg.endsWith("openai-compatible");
  const baseURL = env.SAMURAI_AI_BASE_URL;
  if (compatible && !baseURL)
    throw new ModelSetupError(
      "SAMURAI_AI_BASE_URL is not set; set it to the endpoint of your OpenAI-compatible server, for example http://localhost:11434/v1",
    );
  const module_ = await loadProvider(provider, projectDir);
  const create = module_[provider.factory];
  if (typeof create !== "function")
    throw new ModelSetupError(
      `${provider.pkg} does not export ${provider.factory}; install a version that works with ai 7`,
    );
  const made = (create as (settings: object) => unknown)({
    ...(compatible && { name: "openai-compatible" }),
    ...(baseURL && compatible && { baseURL }),
    ...(apiKey && { apiKey }),
  });
  const model =
    typeof made === "function"
      ? (made as (n: string) => unknown)(name)
      : undefined;
  try {
    return assertModelObject(model);
  } catch {
    throw new ModelSetupError(
      `${provider.pkg} did not give a model for "${name}"; check the package version`,
    );
  }
}

/** The model to use when `--model` is not given: `SAMURAI_AI_MODEL`, else the config's `ai.model` */
export async function defaultModelSpec(
  env: Partial<NodeJS.ProcessEnv>,
): Promise<string | undefined> {
  if (env.SAMURAI_AI_MODEL) return env.SAMURAI_AI_MODEL;
  try {
    return (await readConfig("ai"))?.model;
  } catch {
    return undefined;
  }
}
