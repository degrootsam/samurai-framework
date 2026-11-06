import { startPlan } from "./plan/run.js";
import { startAgent } from "./run.js";
import type {
  AgentOptions,
  AgentSession,
  PlanOptions,
  PlanSession,
} from "./types.js";

export { DEFAULT_LIMITS, resolveLimits, type AgentLimits } from "./limits.js";
export { assertModelObject, type AgentModel } from "./model.js";
export { parsePlan, type ParsedPlan } from "./plan/plan-file.js";
export { readPlan } from "./plan/read-plan.js";
export {
  defaultModelSpec,
  ModelSetupError,
  modelFromSpec,
} from "./providers.js";
export type {
  AgentEndReason,
  AgentEvent,
  AgentOptions,
  AgentResult,
  AgentSession,
  PlanOptions,
  PlanResult,
  PlanSession,
} from "./types.js";
/**
 * Starts the agent on a goal. The model is an AI SDK model object; the run opens a browser, writes typed steps
 * into the spec file as they succeed, and ends with an `ended` event whatever happens. Throws at once for a model
 * that is a string. Needs the optional packages `ai` and `zod`. With `plan` (the text of a plan from `runPlan`)
 * the agent follows that plan, checking each step on the live page.
 */
export function runAgent(options: AgentOptions): AgentSession {
  return startAgent(options);
}

/**
 * Starts the planning agent on a goal: it explores the page and writes a Markdown plan into `out`, a step at a
 * time, for `runAgent`'s `plan` option. The page is read-only: every request that is not a GET is stopped. Same
 * events and `ended` event as `runAgent`, plus `plan-step`. Needs the optional packages `ai` and `zod`.
 */
export function runPlan(options: PlanOptions): PlanSession {
  return startPlan(options);
}
