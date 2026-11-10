import type { ToolSet } from "ai";
import type { AgentLimits } from "./limits.js";
import type { AgentModel } from "./model.js";
import { pruneStalePages } from "./prune-history.js";
import type { AiModule } from "./sdk-tools.js";
import type { AgentController } from "./session.js";

/** What the loop counts, shared with the run that reports it */
export interface RunTally {
  modelCalls: number;
  tokens: number;
  finished: boolean;
}

export interface LoopInput {
  ai: AiModule;
  model: AgentModel;
  system: string;
  prompt: string;
  /** The opening page dump, sent as its own part so it can be pruned once the page moves on */
  page?: string;
  tools: Record<string, unknown>;
  controller: AgentController;
  limits: AgentLimits;
  tally: RunTally;
}

export interface LoopOutcome {
  /** The model's last words when it ended without calling finish */
  text: string;
  /** The loop stopped because of a limit while the model still had work to do */
  limit?: "step-limit" | "token-limit";
}

/**
 * The AI SDK's tool loop with SAMURAI's guards: model calls and tokens are counted after every step (and a
 * `usage` event sent), a paused or taken-over run makes no new model call, and `finish` ends the loop. Time and
 * `stop` abort through the controller's signal.
 */
export async function runLoop(input: LoopInput): Promise<LoopOutcome> {
  const { ai, controller, limits, tally } = input;
  const result = await ai.generateText({
    model: input.model,
    system: input.system,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          ...(input.page === undefined
            ? []
            : [{ type: "text" as const, text: input.page }]),
        ],
      },
    ],
    tools: input.tools as ToolSet,
    abortSignal: controller.signal,
    stopWhen: [
      ai.isStepCount(limits.maxSteps),
      ai.hasToolCall("finish"),
      () => tally.tokens >= limits.maxTokens,
    ],
    prepareStep: async ({ messages }) => {
      await controller.gate();
      return {
        messages: pruneStalePages(messages, {
          openingPage: input.page !== undefined,
        }),
      };
    },
    onStepFinish: (step) => {
      tally.modelCalls++;
      const inputTokens = step.usage.inputTokens ?? 0;
      const outputTokens = step.usage.outputTokens ?? 0;
      tally.tokens += step.usage.totalTokens ?? inputTokens + outputTokens;
      if (step.text.trim() !== "")
        controller.emit({ type: "plan", text: step.text.trim() });
      controller.emit({
        type: "usage",
        inputTokens,
        outputTokens,
        totalTokens: step.usage.totalTokens ?? inputTokens + outputTokens,
      });
    },
  });
  const last = result.steps[result.steps.length - 1];
  const unfinished = last !== undefined && last.toolCalls.length > 0;
  if (tally.finished || !unfinished) return { text: result.text };
  return {
    text: result.text,
    limit: tally.tokens >= limits.maxTokens ? "token-limit" : "step-limit",
  };
}
