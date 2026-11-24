import { parsePlan } from "./plan-file.js";

/** The number of steps in a plan's text; 0 when it cannot be read or has none (then no step can be reported) */
export function planStepCount(plan: string | undefined): number {
  if (plan === undefined) return 0;
  try {
    return parsePlan(plan).steps.length;
  } catch {
    return 0;
  }
}
