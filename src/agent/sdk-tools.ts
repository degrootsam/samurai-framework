import type { AgentTool, ToolResult } from "./tools/context.js";

/** The AI SDK, loaded when a run starts: it is an optional peer dependency */
export type AiModule = typeof import("ai");

/** What stands between the model's call and the tool: waiting while paused, and the note after a hand back */
export interface ToolGate {
  /** Resolves when the agent may act; rejects when the run ended */
  wait(): Promise<void>;
  /** Text to give the model instead of running its call, once, after the person used the browser */
  note(): Promise<string | undefined>;
}

function modelOutput(result: ToolResult) {
  if (!result.ok) return { type: "error-text" as const, value: result.error };
  if (!result.image) return { type: "text" as const, value: result.message };
  return {
    type: "content" as const,
    value: [
      { type: "text" as const, text: result.message },
      {
        type: "file" as const,
        data: { type: "data" as const, data: result.image.data },
        mediaType: result.image.mediaType,
      },
    ],
  };
}

/**
 * The tools in the AI SDK's shape. The SDK is given the JSON schema only: it would answer a wrong call with a
 * dump of the validation library's issues, so the tools validate themselves and answer in a sentence.
 */
export function toSdkTools(
  ai: AiModule,
  tools: readonly AgentTool[],
  gate: ToolGate,
): Record<string, unknown> {
  // A model may call several tools in one step and the SDK runs them at once. They share one page and one spec,
  // so they run one after the other, in the order the model made them
  let queue: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(work: () => Promise<T>): Promise<T> => {
    const turn = queue.then(work, work);
    queue = turn.catch(() => undefined);
    return turn;
  };
  const entries = tools.map((agentTool) => {
    const schema = ai.jsonSchema(
      () => ai.zodSchema(agentTool.inputSchema as never).jsonSchema,
      {
        validate: (value: unknown) => ({ success: true as const, value }),
      },
    );
    return [
      agentTool.name,
      ai.tool({
        description: agentTool.description,
        inputSchema: schema,
        execute: (input: unknown): Promise<ToolResult> =>
          inOrder(async () => {
            await gate.wait();
            const note = await gate.note();
            if (note !== undefined) return { ok: false, error: note };
            return agentTool.run(input);
          }),
        toModelOutput: ({ output }: { output: unknown }) =>
          modelOutput(output as ToolResult),
      } as never),
    ] as const;
  });
  return Object.fromEntries(entries);
}
