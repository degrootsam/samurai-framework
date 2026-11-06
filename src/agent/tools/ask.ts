import { z } from "zod";
import { defineTool } from "./context.js";

export const ask = defineTool({
  name: "ask",
  description:
    "Ask the person a question and wait for the answer. This is the only way to get what you do not know " +
    "(a username, which of two options they want, permission). Do not guess; ask.",
  inputSchema: z.object({
    question: z.string().min(1),
    options: z
      .array(z.string().min(1))
      .max(8)
      .optional()
      .describe("Answers to pick from, when there are a few"),
  }),
  async execute({ question, options }, context) {
    const answer = await context.ask(question, options);
    return { ok: true, message: `The person answered: ${answer}` };
  },
});
