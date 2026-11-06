import { MockLanguageModelV4 } from "ai/test";

/** What the scripted model does in one turn: say something, call tools, or wait until the run is stopped */
interface Turn {
  text?: string;
  calls?: { name: string; args?: unknown }[];
  /** Input and output tokens this turn reports. @default [10, 5] */
  usage?: [number, number];
  /** Never answers: waits for the abort signal, as a slow model does */
  hang?: boolean;
}

/** A turn, or a function of the text of the last tool results (to find the references a snapshot printed) */
export type ScriptedTurn = Turn | ((last: string, call: number) => Turn);

/** Text of the tool results in the newest tool message of a prompt */
function lastToolText(prompt: readonly unknown[]): string {
  for (const message of [...prompt].reverse()) {
    const m = message as { role?: string; content?: unknown };
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    return m.content
      .map((part) => {
        const output = (part as { output?: { type: string; value?: unknown } })
          .output;
        if (!output) return "";
        if (typeof output.value === "string") return output.value;
        if (Array.isArray(output.value))
          return output.value
            .map((p: { text?: string }) => p.text ?? "")
            .join("\n");
        return JSON.stringify(output.value);
      })
      .join("\n");
  }
  return "";
}

/** The first group of `pattern` in `text`, or a failure that shows the text */
export function refIn(text: string, pattern: RegExp): string {
  const found = pattern.exec(text);
  if (!found) throw new Error(`${pattern} is not in:\n${text}`);
  return found[1]!;
}

/**
 * A model that follows a script, for tests: no network. The last turn repeats when the script runs out. It
 * records every prompt it was given in `doGenerateCalls`.
 */
export function scriptedModel(turns: readonly ScriptedTurn[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const index = call++;
      const raw = turns[Math.min(index, turns.length - 1)]!;
      const turn =
        typeof raw === "function"
          ? raw(lastToolText(options.prompt), index)
          : raw;
      if (turn.hang) {
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(new Error("aborted"));
          if (options.abortSignal?.aborted) abort();
          options.abortSignal?.addEventListener("abort", abort, { once: true });
        });
      }
      const calls = turn.calls ?? [];
      const [input, output] = turn.usage ?? [10, 5];
      return {
        content: [
          ...(turn.text ? [{ type: "text" as const, text: turn.text }] : []),
          ...calls.map((c, n) => ({
            type: "tool-call" as const,
            toolCallId: `call-${index}-${n}`,
            toolName: c.name,
            input: JSON.stringify(c.args ?? {}),
          })),
        ],
        finishReason: {
          unified:
            calls.length > 0 ? ("tool-calls" as const) : ("stop" as const),
          raw: undefined,
        },
        usage: {
          inputTokens: {
            total: input,
            noCache: input,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: output, text: output, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
