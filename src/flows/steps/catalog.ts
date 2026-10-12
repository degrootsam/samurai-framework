import type {
  AnyNodeDefinition,
  FlowFile,
  FlowProblem,
  StepInfo,
} from "../core/index.js";
import type { Handler } from "../run/handlers/support.js";
import { infoOf, type StepDefinition } from "./define.js";
import { BUILTIN_SET, BUILTIN_STEPS } from "./set.js";

/** The built-in steps, in library order */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const STEPS: readonly StepDefinition<any>[] = BUILTIN_STEPS;

export const STEP_NODES: readonly AnyNodeDefinition[] = BUILTIN_SET.nodes;

export const STEP_HANDLERS: Readonly<Record<string, Handler>> =
  BUILTIN_SET.handlers;

/** The steps as data, for the app */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const stepCatalog = (
  steps: readonly StepDefinition<any>[] = STEPS,
): StepInfo[] => steps.map(infoOf);

/** The project's steps; the built-in ones for now (test-project steps come later) */
export async function listSteps(): Promise<StepInfo[]> {
  return stepCatalog();
}

/** Only the steps' own `validate` problems: the app checks everything else itself */
export function validateSteps(
  flow: FlowFile,
  options: { tests?: string[]; groups?: string[] },
): FlowProblem[] {
  const tests = options.tests ? new Set(options.tests) : undefined;
  const groups = options.groups ? new Set(options.groups) : undefined;
  return flow.nodes.flatMap((n) => {
    const step = STEPS.find((s) => s.kind === n.kind);
    if (!step?.validate) return [];
    const def = STEP_NODES.find((d) => d.kind === n.kind)!;
    return step.validate(
      {
        ...n,
        config: {
          ...Object.fromEntries(
            step.fields.map((f) => [
              f.path.slice(7),
              "default" in f ? f.default : undefined,
            ]),
          ),
          ...n.config,
        },
      },
      { label: def.label, tests, groups },
    );
  });
}
