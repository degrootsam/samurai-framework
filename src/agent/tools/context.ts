import type { z } from "zod";
import type Page from "../../browser/page.js";
import { maskDeep } from "../../config/mask.js";
import type { Snapshotter } from "../snapshot.js";
import type { AgentEvent } from "../types.js";
import type { OriginPolicy } from "./origins.js";
import type { StepRecorder } from "../recording.js";

/** Secrets the agent may use: it knows the names; values are read here and go no further than the page */
interface SecretAccess {
  readonly allowed: readonly string[];
  /** The value of a secret in the run's environment; undefined when it has none */
  get(name: string): string | undefined;
}

/** What the tools of one run share */
export interface ToolContext {
  page: Page;
  snapshots: Snapshotter;
  steps: StepRecorder;
  origins: OriginPolicy;
  secrets: SecretAccess;
  /** The model takes images, so `screenshot` works */
  vision: boolean;
  /** Time (ms) an action or an assertion waits for the element. @default 5000 */
  actionTimeout: number;
  /** Asks the person and waits for the answer */
  ask(question: string, options?: string[]): Promise<string>;
  /** Records the agent's closing summary; the loop ends after the call */
  finish(summary: string): void;
  emit(event: AgentEvent): void;
  /** A secret was typed into a field the page shows in plain text: screenshots would show it */
  secretOnScreen: boolean;
}

/** What a tool answers the model with. A failure is a result too: the model reads it and tries something else */
export type ToolResult =
  | {
      ok: true;
      message: string;
      /** For a vision model */
      image?: { mediaType: "image/png"; data: string };
    }
  | { ok: false; error: string };

/** A tool as the loop uses it: the model-facing description and schema, and `run` for one call */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  /** Validates `args`, runs the tool and answers; never throws. Secret values are removed from the answer */
  run(args: unknown): Promise<ToolResult>;
}

interface ToolSpec<S extends z.ZodType> {
  name: string;
  description: string;
  inputSchema: S;
  execute(input: z.infer<S>, context: ToolContext): Promise<ToolResult>;
}

/** The first lines of an error message: enough for the model, without a long call log */
export function shortMessage(error: unknown, max = 500): string {
  const text = (error instanceof Error ? error.message : String(error)).trim();
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const joined = lines.slice(0, 4).join(" ");
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}

/** A tool bound to a run. Wraps `execute` so every tool validates, reports and fails the same way */
export function defineTool<S extends z.ZodType>(spec: ToolSpec<S>) {
  return (context: ToolContext): AgentTool => ({
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    async run(args) {
      context.emit({
        type: "tool-call",
        tool: spec.name,
        args: maskDeep(args),
      });
      const parsed = spec.inputSchema.safeParse(args);
      if (!parsed.success) {
        const problems = parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.join(".") || "arguments"}: ${issue.message}`,
          )
          .join("; ");
        return maskDeep({
          ok: false,
          error: `${spec.name}(): invalid arguments (${problems})`,
        });
      }
      try {
        return maskDeep(await spec.execute(parsed.data, context));
      } catch (error) {
        return maskDeep({
          ok: false,
          error: `${spec.name}(): ${shortMessage(error)}`,
        });
      }
    },
  });
}
