import type { Field, FlowProblem, NodeCoreDefinition } from "./nodes/define.js";
import { getPath } from "./nodes/path.js";
import type { FlowNodeModel } from "./schema.js";

/** Rules a step field carries: checked live in the builder and again by checkFlow */
export interface FieldRules {
  required?: boolean;
  /** `number` fields */
  min?: number;
  max?: number;
  /** `text` fields: a regular expression the value must match */
  pattern?: string;
  /** Said instead of the default when `pattern` doesn't match */
  patternMessage?: string;
}

export type StepField = Field & FieldRules;
export type StepSection = "control" | "integrations";

export interface StepOutput {
  name: string;
  label?: string;
}

/** A step as data: what the app's catalog holds. No functions. */
export interface StepInfo {
  /** Stored in flow files as the node's `kind` */
  kind: string;
  label: string;
  /** A design-system icon name */
  icon: string;
  section: StepSection;
  /** `config.*` fields; Title and Description are added by `stepNodeOf` */
  fields: readonly StepField[];
  /** The line under the title: `{config.x}` is replaced with the field's value */
  summary?: string;
  outputs?: readonly StepOutput[];
  /** The path of the field holding a variable name the step writes */
  writesVar?: string;
}

export const STEP_KIND = /^[a-z][a-z0-9-]*$/;
/** A node's own result fields: an output can't take these names */
export const RESERVED_OUTPUTS: readonly string[] = [
  "status",
  "durationMs",
  "error",
];

const TITLE_FIELDS: readonly Field[] = [
  { path: "title", type: "text", label: "Title" },
  { path: "subtitle", type: "text", label: "Description" },
];

const empty = (value: unknown) =>
  value === undefined || (typeof value === "string" && value.trim() === "");

/** Problems with `node`'s values against the fields' rules, as "Label: message" */
export function fieldProblems(
  fields: readonly StepField[],
  node: FlowNodeModel,
  label: string,
): FlowProblem[] {
  const problems: FlowProblem[] = [];
  const add = (message: string) =>
    problems.push({
      level: "error",
      nodeId: node.id,
      message: `${label}: ${message}`,
    });
  for (const f of fields) {
    const name = f.label ?? f.path;
    const value = getPath(node, f.path);
    if (f.required && empty(value)) {
      add(`${name} is required.`);
      continue;
    }
    if (typeof value === "number") {
      if (f.min !== undefined && value < f.min)
        add(`${name} must be at least ${f.min}.`);
      if (f.max !== undefined && value > f.max)
        add(`${name} must be at most ${f.max}.`);
    }
    if (
      f.pattern &&
      typeof value === "string" &&
      value !== "" &&
      !new RegExp(f.pattern).test(value)
    )
      add(f.patternMessage ?? `${name} doesn't match ${f.pattern}.`);
  }
  return problems;
}

/** The definition core's walker and checkFlow use for a step; `validate` is the step's own (engine only) */
export function stepNodeOf(
  info: StepInfo,
  validate?: NodeCoreDefinition["validate"],
): NodeCoreDefinition {
  return {
    kind: info.kind,
    label: info.label,
    shape: "step",
    fields: [...TITLE_FIELDS, ...info.fields],
    onFailure: true,
    results: (info.outputs ?? []).map((o) => o.name),
    ...(info.writesVar !== undefined && { writesVar: info.writesVar }),
    validate: (node, ctx) => [
      ...fieldProblems(info.fields, node, ctx.label),
      ...(validate?.(node, ctx) ?? []),
    ],
  };
}
