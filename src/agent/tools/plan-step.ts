import { z } from "zod";
import { defineTool } from "./context.js";

/**
 * The tool that reports which step of the plan the agent works on: the plan's own number, 1 to `total`. Only a
 * run that follows a plan has it. A number outside the plan, or the step already reported, is ignored.
 */
export function planStepTool(total: number) {
  let current: number | undefined;
  return defineTool({
    name: "planStep",
    description:
      "Say which step of the plan you start on now: the plan's own number for it. Call it before the first act or " +
      "navigate of each plan step. It changes nothing in the test.",
    inputSchema: z.object({
      step: z.number().int().describe("The plan's step number, from 1"),
    }),
    async execute({ step }, context) {
      if (step < 1 || step > total)
        return {
          ok: true,
          message: `Ignored: the plan has ${total} step${total === 1 ? "" : "s"}, numbered 1 to ${total}.`,
        };
      if (step === current)
        return { ok: true, message: `Already on step ${step}.` };
      current = step;
      context.emit({
        type: "planStep",
        index: step - 1,
        total,
        at: Date.now(),
      });
      return { ok: true, message: `Step ${step} of ${total}.` };
    },
  });
}
