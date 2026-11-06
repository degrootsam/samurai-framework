import { z } from "zod";
import { defineTool } from "./context.js";

export const undo = defineTool({
  name: "undo",
  description:
    "Take the last steps you wrote out of the test, for a step that was a mistake or a detour (a failed attempt, a reset). " +
    "It only edits the test: the page stays as it is, so take a new snapshot (or reload) before you carry on.",
  inputSchema: z.object({
    count: z.number().int().min(1).max(20).optional(),
  }),
  async execute({ count }, context) {
    const wanted = count ?? 1;
    const removed = context.steps.undo(wanted);
    if (removed === 0)
      return {
        ok: false,
        error: "undo(): there is no step of yours to remove",
      };
    return {
      ok: true,
      message: `Removed the last ${removed} step${removed === 1 ? "" : "s"} from the test${removed < wanted ? ` (only ${removed} were yours)` : ""}. The page was not changed.`,
    };
  },
});
