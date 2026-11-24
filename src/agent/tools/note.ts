import { z } from "zod";
import { maskText, registerSecret } from "../../config/mask.js";
import type { AgentTool, ToolContext } from "./context.js";

/** The longest note shown; a longer one is cut */
export const NOTE_MAX = 160;
/** Tools that keep their own text: a note on them would say the same twice */
const NO_NOTE = new Set(["finish", "ask", "question", "planStep"]);
/** What stands for a removed typed value */
const HIDDEN = "••••";

/** A note as the person sees it: one line, no secret value, no typed value, cut to `NOTE_MAX` */
function cleanNote(
  note: unknown,
  context: ToolContext,
  typed?: string,
): string | undefined {
  if (typeof note !== "string") return undefined;
  for (const name of context.secrets.allowed) {
    const value = context.secrets.get(name);
    if (value) registerSecret(name, value);
  }
  let text = maskText(note.replace(/\s+/g, " ").trim());
  if (typed !== undefined && typed.length >= 2)
    text = text.split(typed).join(HIDDEN);
  if (text === "") return undefined;
  return text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX - 1)}…` : text;
}

/**
 * Gives a tool an optional `note` argument: one short sentence the agent writes about what it saw or will do
 * next. The note becomes a `narration` event, sent before the call's `tool-call` event, and is not passed on to
 * the tool. A note that is not text is ignored, a long one is cut.
 */
function withNote(tool: AgentTool, context: ToolContext): AgentTool {
  const schema = tool.inputSchema as z.ZodObject<z.ZodRawShape>;
  return {
    ...tool,
    inputSchema: schema.extend({
      note: z
        .unknown()
        .optional()
        .describe(
          `One short sentence (under ${NOTE_MAX} characters) about what you saw or will do next. Never a secret or a typed value`,
        ),
    }),
    run(args) {
      if (typeof args !== "object" || args === null) return tool.run(args);
      const { note, ...rest } = args as { note?: unknown; value?: unknown };
      const text = cleanNote(
        note,
        context,
        typeof rest.value === "string" ? rest.value : undefined,
      );
      if (text !== undefined)
        context.emit({ type: "narration", text, at: Date.now() });
      return tool.run(rest);
    },
  };
}

/** The tools with a `note`, when the run is watched; otherwise unchanged */
export function withNotes(
  tools: AgentTool[],
  context: ToolContext,
  enabled: boolean,
): AgentTool[] {
  if (!enabled) return tools;
  return tools.map((tool) =>
    NO_NOTE.has(tool.name) || !("extend" in tool.inputSchema)
      ? tool
      : withNote(tool, context),
  );
}
