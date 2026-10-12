import type { AnyNodeDefinition, StepInfo } from "../core/index.js";
import type { Handler } from "../run/handlers/support.js";
import { api } from "./api.js";
import { checkStep, infoOf, stepNode, type StepDefinition } from "./define.js";
import { stepHandler } from "./handler.js";
import { setVariable } from "./set-variable.js";
import { wait } from "./wait.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStep = StepDefinition<any>;

/** The built-in steps, in library order */
export const BUILTIN_STEPS: readonly AnyStep[] = [wait, setVariable, api];

/** Everything a project's steps give the walker, the check and the app */
export interface StepSet {
  /** The built-ins, then the project's in config order */
  steps: readonly AnyStep[];
  nodes: readonly AnyNodeDefinition[];
  handlers: Readonly<Record<string, Handler>>;
  /** The steps as data, for the app */
  catalog: StepInfo[];
}

const WHERE = " (samurai.config.ts)";

/** The built-in steps plus a project's (its config's `steps`). Throws for a list that can't work. */
export function stepSet(projectSteps: unknown = []): StepSet {
  if (!Array.isArray(projectSteps))
    throw new Error("samurai.config.ts: steps must be a list of steps.");
  const builtin = new Set(BUILTIN_STEPS.map((s) => s.kind));
  const seen = new Set<string>();
  projectSteps.forEach((entry: unknown, i) => {
    const kind =
      entry && typeof entry === "object"
        ? (entry as { kind?: unknown }).kind
        : undefined;
    if (typeof kind !== "string" || kind === "")
      throw new Error(
        `Step #${i + 1}${WHERE}: it has no kind; make it with defineStep.`,
      );
    checkStep(entry as AnyStep, WHERE);
    if (builtin.has(kind))
      throw new Error(
        `Step "${kind}"${WHERE}: a built-in step already uses this kind.`,
      );
    if (seen.has(kind))
      throw new Error(`Step "${kind}"${WHERE}: declared twice.`);
    seen.add(kind);
  });
  const steps = [...BUILTIN_STEPS, ...(projectSteps as AnyStep[])];
  return {
    steps,
    nodes: steps.map(stepNode),
    handlers: Object.fromEntries(steps.map((s) => [s.kind, stepHandler(s)])),
    catalog: steps.map(infoOf),
  };
}

/** The built-in steps alone */
export const BUILTIN_SET: StepSet = stepSet();
