import {
  CLOSED_KINDS,
  RESERVED_OUTPUTS,
  STEP_KIND,
  stepNodeOf,
  type AnyNodeDefinition,
  type NodeCoreDefinition,
  type StepField,
  type StepInfo,
} from "../core/index.js";

type RunValueOf<F> = F extends { type: "expression" }
  ? unknown
  : F extends { type: "number" }
    ? number
    : F extends { type: "switch" }
      ? boolean
      : string;

/** `config` as `run` sees it: expression fields arrive evaluated */
export type RunConfigOf<F extends readonly StepField[]> = {
  [
    K in F[number] as K["path"] extends `config.${infer P}` ? P : never
  ]: RunValueOf<K>;
};

export interface StepRunInput<C> {
  config: C;
  env: Readonly<Record<string, unknown>>;
  vars: Readonly<Record<string, unknown>>;
  node: { id: string; key?: string; title?: string };
  /** Aborted when the run is stopped */
  signal: AbortSignal;
  /** Waits, unless the run is stopped first */
  sleep: (ms: number) => Promise<void>;
  log: (level: "info" | "warn" | "error", text: string) => void;
}

export interface StepResult {
  /** Declared in `outputs`; readable later as `nodes.<key>.<name>` */
  outputs?: Record<string, unknown>;
  /** Only the name the `writesVar` field holds */
  vars?: Record<string, unknown>;
  note?: string;
}

export interface StepDefinition<C = Record<string, unknown>> extends StepInfo {
  /** Problems with this node alone; runs in the engine (checks and before a run) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validate?: NodeCoreDefinition<string, any>["validate"];
  /** What the step does in a run: return to pass, throw to fail */
  run: (input: StepRunInput<C>) => Promise<StepResult | void>;
}

/** Declares a flow step: one way in, one way out. Throws for a definition that can't work. */
export function defineStep<const F extends readonly StepField[]>(
  def: Omit<StepDefinition<RunConfigOf<F>>, "fields"> & { fields: F },
): StepDefinition<RunConfigOf<F>> {
  const name = `Step "${def.kind}"`;
  if (CLOSED_KINDS.includes(def.kind))
    throw new Error(
      `${name}: "${def.kind}" is a closed kind; steps can't replace it.`,
    );
  if (!STEP_KIND.test(def.kind))
    throw new Error(
      `${name}: "${def.kind}" isn't a valid step kind. Use lowercase letters, digits and -.`,
    );
  for (const f of def.fields) {
    if (!f.path.startsWith("config."))
      throw new Error(`${name}: field "${f.path}" must be a config. path.`);
    if (f.pattern !== undefined)
      try {
        new RegExp(f.pattern);
      } catch {
        throw new Error(
          `${name}: field "${f.path}" has a pattern that isn't a valid regular expression.`,
        );
      }
  }
  const outputs = (def.outputs ?? []).map((o) => o.name);
  for (const o of outputs) {
    if (RESERVED_OUTPUTS.includes(o))
      throw new Error(`${name}: output "${o}" is reserved.`);
    if (outputs.indexOf(o) !== outputs.lastIndexOf(o))
      throw new Error(`${name}: output "${o}" is declared twice.`);
  }
  if (
    def.writesVar !== undefined &&
    !def.fields.some((f) => f.path === def.writesVar)
  )
    throw new Error(
      `${name}: writesVar "${def.writesVar}" isn't one of its fields.`,
    );
  return def;
}

/** The step as data, without its functions: what the catalog holds */
export function infoOf(step: StepDefinition<never>): StepInfo {
  const { run: _run, validate: _validate, ...info } = step;
  void _run;
  void _validate;
  return JSON.parse(JSON.stringify(info)) as StepInfo;
}

/** The definition the walker and checkFlow use for a step */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const stepNode = (step: StepDefinition<any>): AnyNodeDefinition =>
  stepNodeOf(infoOf(step), step.validate);
