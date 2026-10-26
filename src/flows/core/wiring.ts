import { dominates, meetOf, reachOrder } from "./graph.js";
import { isInputSource, type FlowFile, type FlowNodeModel } from "./schema.js";

/**
 * What a flow needs to know about the project's tests and groups to wire inputs:
 * each test's declared inputs (with their defaults) and outputs, by test id, and
 * each group's test ids, by group name. `checkFlowInProject` builds it from the
 * project; the SAMURAI app builds it from `listTests` / `listGroups`.
 */
export interface FlowFacts {
  tests: Record<
    string,
    { inputs: { name: string; default: string }[]; outputs: string[] }
  >;
  groups: Record<string, string[]>;
}

/**
 * The facts for a project's tests and groups, as `listTests` and `listGroups` give them: a test's `id`, its
 * `inputs` and `outputs` (absent when it declares none) and a group's `name` and `testIds`. The lists are copied.
 */
export function flowFactsFrom(
  tests: readonly {
    id: string;
    inputs?: readonly { name: string; default: string }[];
    outputs?: readonly string[];
  }[],
  groups: readonly { name: string; testIds: readonly string[] }[],
): FlowFacts {
  return {
    tests: Object.fromEntries(
      tests.map((t) => [
        t.id,
        {
          inputs: (t.inputs ?? []).map(({ name, default: value }) => ({
            name,
            default: value,
          })),
          outputs: [...(t.outputs ?? [])],
        },
      ]),
    ),
    groups: Object.fromEntries(groups.map((g) => [g.name, [...g.testIds]])),
  };
}

/** Where one input of a node gets its value. Computed, never stored */
export type InputWiring =
  | { from: "node"; nodeId: string; output: string }
  | { from: "expression"; expression: string }
  | { from: "default"; value: string }
  | { from: "none" };

/**
 * Whether node `d` always ran before node `n`. Directly: `d` dominates `n`, or `d`
 * sits on a Parallel branch that every path from the Parallel into the branch's end
 * passes, and the Parallel's meet dominates `n`. Through nested Parallels: `d`
 * always ran before some Parallel's meet, which always ran before `n`. A Parallel
 * runs all its branches; a Condition runs one arm, so a node on one arm never
 * always ran.
 */
export function alwaysBefore(flow: FlowFile, d: string, n: string): boolean {
  return before(flow, parallelMeets(flow), d, n, new Set());
}

/** alwaysBefore over `meets`; `path` holds the meets on the current chain, so a looping flow still ends */
function before(
  flow: FlowFile,
  meets: string[],
  d: string,
  n: string,
  path: Set<string>,
): boolean {
  if (d === n) return false;
  if (directlyBefore(flow, d, n)) return true;
  return meets.some((meet) => {
    if (meet === n || path.has(meet) || !directlyBefore(flow, d, meet))
      return false;
    path.add(meet);
    const ran = before(flow, meets, meet, n, path);
    path.delete(meet);
    return ran;
  });
}

/** The meet of every Parallel in the flow */
const parallelMeets = (flow: FlowFile): string[] =>
  flow.nodes
    .filter((p) => p.kind === "parallel")
    .map((p) => meetOf(flow, p.id))
    .filter((m): m is string => !!m);

/** `d` dominates `n`, or `d` is on a Parallel branch every path into its meet passes, and the meet dominates `n` */
function directlyBefore(flow: FlowFile, d: string, n: string): boolean {
  if (dominates(flow, d, n)) return d !== n;
  return flow.nodes.some((p) => {
    if (p.kind !== "parallel") return false;
    const meet = meetOf(flow, p.id);
    if (!meet || !dominates(flow, meet, n)) return false;
    return flow.edges.some(
      (e) => e.source === p.id && passesBefore(flow, e.target, d, meet),
    );
  });
}

/** Whether every path from `from` to `meet` passes `d` (and one does) */
function passesBefore(flow: FlowFile, from: string, d: string, meet: string) {
  if (from === d) return d !== meet;
  if (!reachOrder(flow, from).includes(d)) return false;
  const seen = new Set<string>([d]);
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === meet) return false;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of flow.edges) if (e.source === id) stack.push(e.target);
  }
  return true;
}

/**
 * A Test or Group node's declared inputs, with their defaults. A group's inputs
 * are the union of its tests' inputs; the first default wins. Empty without facts
 * or for a test or group the facts don't know.
 */
export function declaredInputs(
  node: FlowNodeModel,
  facts: FlowFacts | undefined,
): Map<string, string> {
  const inputs = new Map<string, string>();
  if (!facts) return inputs;
  const testIds =
    node.kind === "test"
      ? [node.ref?.testId]
      : node.kind === "group"
        ? (facts.groups[node.ref?.group ?? ""] ?? [])
        : [];
  for (const id of testIds)
    for (const input of (id && facts.tests[id]?.inputs) || [])
      if (!inputs.has(input.name)) inputs.set(input.name, input.default);
  return inputs;
}

/** The outputs a Test node declares; none for any other node */
export const declaredOutputs = (
  node: FlowNodeModel,
  facts: FlowFacts | undefined,
): readonly string[] =>
  (node.kind === "test" &&
    node.ref?.testId &&
    facts?.tests[node.ref.testId]?.outputs) ||
  [];

/**
 * Where each declared input of `nodeId` comes from, in this order: the node's
 * override expression (Test nodes only), its "use the default", the closest Test
 * node that always ran before it and declares an output of that name (of two in a
 * row, the later one), else none.
 */
export function wiringAt(
  flow: FlowFile,
  nodeId: string,
  options: { facts?: FlowFacts } = {},
): Record<string, InputWiring> {
  const node = flow.nodes.find((n) => n.id === nodeId);
  if (!node) return {};
  const wiring: Record<string, InputWiring> = {};
  let producers: FlowNodeModel[] | undefined;
  for (const [name, value] of declaredInputs(node, options.facts)) {
    // A flow built in memory may hold anything here: only an InputSource is read
    const entry: unknown = node.inputs?.[name];
    const source = isInputSource(entry) ? entry : undefined;
    if (source && "expression" in source && node.kind === "test")
      wiring[name] = { from: "expression", expression: source.expression };
    else if (source && "useDefault" in source)
      wiring[name] = { from: "default", value };
    else {
      producers ??= flow.nodes.filter(
        (p) =>
          declaredOutputs(p, options.facts).length > 0 &&
          alwaysBefore(flow, p.id, nodeId),
      );
      const from = closest(
        flow,
        producers.filter((p) =>
          declaredOutputs(p, options.facts).includes(name),
        ),
      );
      wiring[name] = from
        ? { from: "node", nodeId: from.id, output: name }
        : { from: "none" };
    }
  }
  return wiring;
}

/** The candidate no other candidate always ran after; on a tie, the last a walk from Start meets */
function closest(flow: FlowFile, candidates: FlowNodeModel[]) {
  const latest = candidates.filter(
    (c) => !candidates.some((o) => o !== c && alwaysBefore(flow, c.id, o.id)),
  );
  if (latest.length <= 1) return latest[0];
  const start = flow.nodes.find((n) => n.kind === "start");
  const order = start ? reachOrder(flow, start.id) : [];
  return latest.sort((a, b) => order.indexOf(b.id) - order.indexOf(a.id))[0];
}
