import { startAgent, type RunDeps } from "../run.js";
import type { PlanOptions, PlanSession } from "../types.js";
import { planKind } from "./plan-kind.js";

/**
 * Starts a planning run: the agent explores the page and writes a Markdown plan into `out` after each step it
 * records. It never submits: every request that is not a GET is stopped. The same events and the same `ended`
 * event as `runAgent`, plus `plan-step`. Throws at once for a model that is a string.
 */
export function startPlan(
  options: PlanOptions,
  deps: RunDeps = {},
): PlanSession {
  return startAgent(options, deps, planKind);
}
