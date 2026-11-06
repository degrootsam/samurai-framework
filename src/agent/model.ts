import type { LanguageModel } from "ai";

/**
 * A model object from an AI SDK provider package (`anthropic("...")`, `openai("...")`, an OpenAI-compatible
 * endpoint). Never a string: the SDK resolves a bare string through the Vercel AI Gateway, a third party the
 * user did not choose, which would receive the page content.
 */
export type AgentModel = Exclude<LanguageModel, string>;

const VERSIONS = ["v2", "v3", "v4"];

/** `model` as an `AgentModel`; throws for a string id or anything that is not a model object */
export function assertModelObject(model: unknown): AgentModel {
  if (typeof model === "string")
    throw new Error(
      `agent(): model must be a model object from a provider package, not the string "${model}" ` +
        "(a string id would send the page through the Vercel AI Gateway). " +
        'Install the provider (for example @ai-sdk/anthropic) and pass anthropic("model-name")',
    );
  const version =
    typeof model === "object" && model !== null
      ? (model as { specificationVersion?: unknown }).specificationVersion
      : undefined;
  if (typeof version !== "string" || !VERSIONS.includes(version))
    throw new Error(
      "agent(): model must be an AI SDK language model object (it has no specificationVersion v2, v3 or v4)",
    );
  return model as AgentModel;
}
