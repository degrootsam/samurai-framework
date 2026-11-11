import { applyEdit } from "../steps/edit.js";
import type { Step } from "../steps/model.js";
import { parseSpec } from "../steps/parse.js";

/** What a test declared in its options: the names of its `inputs` and `outputs` */
export interface Declared {
  inputs: ReadonlySet<string>;
  outputs: ReadonlySet<string>;
}

/** The declarations test number `test` of `source` has now */
export function declaredIn(source: string, test: number): Declared {
  const parsed = parseSpec(source)[test];
  return {
    inputs: new Set(parsed?.inputs?.map((input) => input.name)),
    outputs: new Set(parsed?.outputs),
  };
}

/** The output a step saves, if any */
function outputOf(step: Step): string | undefined {
  if (step.kind === "saveOutput") return step.name;
  return step.kind === "fill" || step.kind === "expect"
    ? step.output
    : undefined;
}

/**
 * `source` without the inputs and outputs of test number `test` that the agent's run declared (they are not in
 * `before`) and no step reads or saves any more: what is left behind when `undo` removes the step that declared them
 */
export function pruneDeclared(
  source: string,
  test: number,
  before: Declared,
): string {
  const parsed = parseSpec(source)[test];
  if (!parsed) return source;
  const steps = parsed.steps.map(({ step }) => step);
  const read = new Set(
    steps.flatMap((step) =>
      step.kind === "fill" && step.value.kind === "input"
        ? [step.value.name]
        : [],
    ),
  );
  const saved = new Set(steps.flatMap((step) => outputOf(step) ?? []));
  const inputs = parsed.inputs ?? [];
  const outputs = parsed.outputs ?? [];
  const keptInputs = inputs.filter(
    ({ name }) => before.inputs.has(name) || read.has(name),
  );
  const keptOutputs = outputs.filter(
    (name) => before.outputs.has(name) || saved.has(name),
  );
  return applyEdit(source, {
    op: "declare",
    test,
    ...(keptInputs.length !== inputs.length && { inputs: keptInputs }),
    ...(keptOutputs.length !== outputs.length && { outputs: keptOutputs }),
  });
}
