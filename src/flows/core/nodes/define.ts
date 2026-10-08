import type { FlowNodeModel } from "../schema.js";

/** A problem `checkFlow` or a node's `validate` reports */
export interface FlowProblem {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
}

/** What a node's `validate` can read besides the node itself */
export interface NodeCtx {
  /** The definition's `label`: the one place a node's name is written */
  label: string;
  /** The test ids that exist; undefined when checkFlow was not given them (no reference check) */
  tests?: ReadonlySet<string>;
  /** The group names that exist; undefined when checkFlow was not given them */
  groups?: ReadonlySet<string>;
}

export interface Option {
  label: string;
  value: string;
}

interface FieldBase {
  /** Where the value lives in the node: `title`, `subtitle`, `continueSession`, `config.<key>`, `ref.testId` or `ref.group` */
  path: string;
  label?: string;
}

/**
 * One setting of a node, as data. The editor decides how to render it. The app's
 * `custom` field type (a React component) is not part of core: the editor attaches
 * those to a kind itself.
 */
export type Field =
  | (FieldBase & { type: "text"; placeholder?: string; default?: string })
  | (FieldBase & { type: "code"; placeholder?: string; default?: string })
  | (FieldBase & {
      type: "expression";
      placeholder?: string;
      default?: string;
    })
  | (FieldBase & { type: "number"; unit?: string; default?: number })
  | (FieldBase & { type: "select"; options: Option[]; default?: string })
  | (FieldBase & { type: "segmented"; options: Option[]; default?: string })
  | (FieldBase & { type: "switch"; default?: boolean })
  | (FieldBase & { type: "test" })
  | (FieldBase & { type: "group" });

/** How a run treats a node in the graph */
export type Shape = "start" | "end" | "step" | "branches";

/** The tones of the design system's flow chips */
export type BranchTone = "neutral" | "success" | "warning" | "error" | "info";

/** One named way out of a `branches` node */
export interface Branch {
  /** Stored as the edge's `sourceHandle` */
  name: string;
  /** The chip on the canvas; leave it out for no chip */
  label?: string;
  /** The chip's colour: a theme tone, or any CSS colour such as "#7c3aed" */
  color?: BranchTone | (string & {});
}

/** Branches that come and go: filled ones plus one empty to drop onto, at least `min` in all */
export interface DynamicBranches {
  dynamic: true;
  min: number;
}

/** The type a field's value has in `config` */
type ValueOf<F> = F extends { type: "number" }
  ? number
  : F extends { type: "switch" }
    ? boolean
    : string;

/** `config` as the definition's `config.*` fields describe it */
export type ConfigOf<F extends readonly Field[]> = {
  [
    K in F[number] as K["path"] extends `config.${infer P}` ? P : never
  ]: ValueOf<K>;
};

/** A node whose `config` is typed (and filled from the field defaults) */
export type TypedNode<C> = Omit<FlowNodeModel, "config"> & { config: C };

/**
 * The core half of a node kind: data and pure functions only. What a kind does in a
 * run is a handler in `flows/run`; how it looks is the editor's half.
 */
export interface NodeCoreDefinition<
  K extends string = string,
  C = Record<string, unknown>,
> {
  /** Stored in flow files as the node's `kind` */
  kind: K;
  /** The kind's name; messages use it */
  label: string;
  shape: Shape;
  /**
   * `branches`: a fixed list (the first is the one kept on delete), or
   * `{ dynamic: true, min }` for a list that grows as branches are filled, named `branch-<n>`
   */
  branches?: readonly Branch[] | DynamicBranches;
  fields: readonly Field[];
  /** The node can write outputs (shared-context variables) */
  outputs?: boolean;
  /** The node has an "on failure" choice */
  onFailure?: boolean;
  /** Pure: problems with this node alone. `node.config` has the field defaults filled in. */
  validate?: (node: TypedNode<C>, ctx: NodeCtx) => FlowProblem[];
}

/** Any definition, for the registry */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNodeDefinition = NodeCoreDefinition<string, any>;

/** Declares a node kind; the type of `config` comes from the `config.*` fields */
export function defineNode<
  const K extends string,
  const F extends readonly Field[],
>(
  def: Omit<NodeCoreDefinition<K, ConfigOf<F>>, "fields"> & { fields: F },
): NodeCoreDefinition<K, ConfigOf<F>> {
  return def;
}

/** The values the definition's `config.*` fields start with */
export function configDefaults(
  def: Pick<AnyNodeDefinition, "fields">,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const f of def.fields)
    if (
      f.path.startsWith("config.") &&
      "default" in f &&
      f.default !== undefined
    )
      config[f.path.slice("config.".length)] = f.default;
  return config;
}

/** The node with every field default filled in, so `validate` sees typed config even for old files */
export function withDefaults<C>(
  def: NodeCoreDefinition<string, C>,
  node: FlowNodeModel,
): TypedNode<C> {
  return {
    ...node,
    config: { ...configDefaults(def), ...node.config },
  } as TypedNode<C>;
}
