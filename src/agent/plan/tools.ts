import { z } from "zod";
import { act } from "../tools/act.js";
import {
  defineTool,
  type AgentTool,
  type ToolContext,
  type ToolResult,
} from "../tools/context.js";
import { finish } from "../tools/finish.js";
import { navigate } from "../tools/navigate.js";
import { snapshot } from "../tools/snapshot.js";
import type { PlanRecorder } from "./recorder.js";

/** What the planner's tools share: the run's tools context and the plan */
interface PlanToolContext extends ToolContext {
  plan: PlanRecorder;
}

const step = defineTool({
  name: "step",
  description:
    "Write one step into the plan, after you did it on the live page with act or navigate. Say what to do the way " +
    'snapshot names it (role and name, for example: Click "Create account" (button)), and in expect what showed ' +
    "afterwards. It is refused when you did nothing since the last step. One step per thing done.",
  inputSchema: z.object({
    text: z.string().min(1).max(600),
    expect: z.string().min(1).max(400).optional(),
  }),
  async execute({ text, expect }, context: PlanToolContext) {
    const n = context.plan.addStep(text, expect);
    return { ok: true, message: `Step ${n} written to the plan.` };
  },
});

const seen = defineTool({
  name: "seen",
  description:
    "Note something about the page that a test writer needs and that is not a step: headings, forms and their " +
    "fields, validation messages, what changed. One short line.",
  inputSchema: z.object({ text: z.string().min(1).max(600) }),
  async execute({ text }, context: PlanToolContext) {
    context.plan.seen(text);
    return { ok: true, message: "Noted under 'Seen on the page'." };
  },
});

const notDone = defineTool({
  name: "notDone",
  description:
    "Note something you did not do or could not see: a step you did not take because it would submit or change " +
    "data, a state you could not reach, a request that was blocked. The test writer will check these first.",
  inputSchema: z.object({ text: z.string().min(1).max(600) }),
  async execute({ text }, context: PlanToolContext) {
    context.plan.notDone(text);
    return { ok: true, message: "Noted under 'Not done'." };
  },
});

const question = defineTool({
  name: "question",
  description:
    "Ask the person a question and wait for the answer; it is also kept in the plan under 'Open questions'. " +
    "Use it for what you do not know (a value, a choice, permission). Do not guess; ask.",
  inputSchema: z.object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).max(8).optional(),
  }),
  async execute({ question: text, options }, context: PlanToolContext) {
    context.plan.question(text);
    const answer = await context.ask(text, options);
    return { ok: true, message: `The person answered: ${answer}` };
  },
});

/** Says what the guard stopped after any call, so the agent writes it down and does not try again */
function withBlockedNotice(tool: AgentTool, plan: PlanRecorder): AgentTool {
  return {
    ...tool,
    async run(args) {
      const result = await tool.run(args);
      const blocked = plan.takeBlocked();
      if (blocked.length === 0) return result;
      const note = `blocked: the planner does not submit (${blocked.join(", ")}); note it with notDone`;
      return result.ok
        ? ({ ...result, message: `${result.message} ${note}` } as ToolResult)
        : { ok: false, error: `${result.error} ${note}` };
    },
  };
}

const ACT_FOR_PLANS =
  "Do one thing to an element of the latest snapshot: click, fill (type text), select (an option of a dropdown), " +
  "check, uncheck, hover, dblclick, clear or press (a key). Nothing is written by act: record it with step once it " +
  "worked. Requests that change data are blocked, so a submit button does nothing; note it with notDone. " +
  "Take a new snapshot after the page changes.";

/** The planner's tools, bound to a run: the shared ones that read and act, and the ones that write the plan */
export function createPlanTools(
  context: ToolContext,
  plan: PlanRecorder,
): AgentTool[] {
  const bound = Object.assign(context, { plan });
  return [
    snapshot(context),
    navigate(context),
    { ...act(context), description: ACT_FOR_PLANS },
    step(bound),
    seen(bound),
    notDone(bound),
    question(bound),
    finish(context),
  ].map((tool) => withBlockedNotice(tool, plan));
}
