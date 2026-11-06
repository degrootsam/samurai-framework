import { z } from "zod";
import { defineTool } from "./context.js";

export const finish = defineTool({
  name: "finish",
  description:
    "End the run when the test does what was asked, or when you cannot go on. Say in the summary what the test covers, " +
    "and anything the person must do (secrets to set, steps to review).",
  inputSchema: z.object({ summary: z.string().min(1) }),
  async execute({ summary }, context) {
    context.finish(summary);
    return { ok: true, message: "Finished." };
  },
});
