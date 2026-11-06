import { maskText } from "../../config/mask.js";
import type { RunKind } from "../run-kind.js";
import type { PlanOptions } from "../types.js";
import { installPlanGuard } from "./guard.js";
import { createPlan } from "./plan-file.js";
import { buildPlanPrompt } from "./prompt.js";
import { PlanRecorder } from "./recorder.js";
import { createPlanTools } from "./tools.js";

/** The run of `runPlan`: steps go into a Markdown plan, and the page cannot change data */
export const planKind: RunKind<PlanOptions, PlanRecorder> = {
  file: (options) => options.out,
  sink: (options, { baseURL, emit }) =>
    new PlanRecorder(
      createPlan({
        goal: options.goal,
        start: options.url ?? baseURL ?? "",
        out: options.out,
        ...(options.force !== undefined && { force: options.force }),
      }),
      (n, text) => emit({ type: "plan-step", n, text }),
    ),
  opened: (plan, url) => plan.setStart(url),
  tools: (context, plan) => createPlanTools(context, plan),
  prompt: (input) => buildPlanPrompt(input),
  opening: (options, first) => `Goal: ${options.goal}\n\n${first}`,
  secrets: () => [],
  guard: (page, plan) => installPlanGuard(page, (what) => plan.block(what)),
  person: ({ snapshots }) => ({
    // The person's clicks write nothing: only the agent writes the plan. It is told the page may have changed
    begin: () => Promise.resolve(),
    end: async () =>
      `The person used the browser while you were stopped. The page may have changed; this is the page now:\n\n${maskText((await snapshots.take()).text)}\n\nYour last call was not run. Call it again only if it is still needed.`,
    dispose: () => Promise.resolve(),
  }),
};
