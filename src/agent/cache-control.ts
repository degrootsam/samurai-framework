import type { ModelMessage } from "ai";

/** True when the model is an AI SDK model object from an Anthropic provider */
export function isAnthropic(model: unknown): boolean {
  if (typeof model !== "object" || model === null) return false;
  const provider = (model as { provider?: unknown }).provider;
  return typeof provider === "string" && provider.startsWith("anthropic");
}

type Options = Record<string, Record<string, unknown>>;

function withoutMark(message: ModelMessage): ModelMessage {
  const options = message.providerOptions as Options | undefined;
  if (options?.["anthropic"] === undefined) return message;
  const { anthropic, ...others } = options;
  const { cacheControl: _dropped, ...rest } = anthropic;
  const kept: Options = { ...others };
  if (Object.keys(rest).length > 0) kept["anthropic"] = rest;
  const { providerOptions: _old, ...bare } = message;
  return (
    Object.keys(kept).length > 0 ? { ...bare, providerOptions: kept } : bare
  ) as ModelMessage;
}

/**
 * Anthropic caches the prompt up to a marked message. One mark on the last message caches the system prompt, the
 * tools and every earlier message, and the mark moves forward each step. Returns a new array; the input is not changed.
 */
export function withCacheBreakpoint(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  const out = messages.map(withoutMark);
  const last = out[out.length - 1];
  if (last === undefined) return out;
  const options = (last.providerOptions ?? {}) as Options;
  out[out.length - 1] = {
    ...last,
    providerOptions: {
      ...options,
      anthropic: {
        ...options["anthropic"],
        cacheControl: { type: "ephemeral" },
      },
    },
  } as ModelMessage;
  return out;
}
