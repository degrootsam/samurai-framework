import { problemOf, scopeAt } from "./expression/index.js";
import { meetOf, reachOrder } from "./graph.js";
import type { AnyNodeDefinition } from "./nodes/define.js";
import type { FlowProblem } from "./nodes/index.js";
import type { FlowFile, FlowNodeModel } from "./schema.js";
import {
  declaredInputs,
  declaredOutputs,
  wiringAt,
  type FlowFacts,
} from "./wiring.js";

/** What checkFlow hands the input and output checks */
interface IoCheck {
  facts: FlowFacts;
  /** Expressions are checked only when the environment is known */
  environment?: { name: string; variables: Record<string, unknown> };
  nodes?: readonly AnyNodeDefinition[];
  /** A node's name in messages */
  titleOf: (node: FlowNodeModel) => string;
}

/**
 * Problems with inputs and outputs: an input with no source, an override expression
 * that doesn't check out, an entry for an input the test doesn't declare, a Group
 * node with an expression, and two branches of one Parallel saving the same output.
 */
export function ioProblems(flow: FlowFile, check: IoCheck): FlowProblem[] {
  return [
    ...flow.nodes.flatMap((n) =>
      n.kind === "test" || n.kind === "group"
        ? inputProblems(flow, n, check)
        : [],
    ),
    ...flow.nodes
      .filter((n) => n.kind === "parallel")
      .flatMap((p) => branchClashes(flow, p, check)),
  ];
}

function inputProblems(
  flow: FlowFile,
  node: FlowNodeModel,
  check: IoCheck,
): FlowProblem[] {
  const known =
    node.kind === "test"
      ? !!node.ref?.testId && !!check.facts.tests[node.ref.testId]
      : !!node.ref?.group && !!check.facts.groups[node.ref.group];
  if (!known) return [];
  const problems: FlowProblem[] = [];
  const at = (level: FlowProblem["level"], message: string) =>
    problems.push({ level, nodeId: node.id, message });
  const declared = declaredInputs(node, check.facts);
  const groupSet = new Set<string>();
  for (const [name, source] of Object.entries(node.inputs ?? {})) {
    if (!declared.has(name))
      at(
        "warning",
        `input "${name}" is not used by this ${node.kind === "group" ? "node" : "test"}`,
      );
    else if (!("expression" in source)) continue;
    else if (node.kind === "group") groupSet.add(name);
    else if (check.environment) {
      const problem = problemOf(
        source.expression,
        scopeAt(flow, node.id, check.environment, {
          nodes: check.nodes,
          facts: check.facts,
        }),
      );
      if (problem)
        at(
          "error",
          `${check.titleOf(node)}: input "${name}": ${problem.message}`,
        );
    }
  }
  if (groupSet.size)
    at(
      "error",
      `Group nodes can't set inputs (${[...groupSet].map((x) => `"${x}"`).join(", ")})`,
    );
  for (const [name, wiring] of Object.entries(
    wiringAt(flow, node.id, { facts: check.facts }),
  ))
    if (wiring.from === "none" && !groupSet.has(name))
      at(
        "error",
        `${check.titleOf(node)}: input "${name}" has no source. Save it as an output in an earlier test, set an expression, or use the default`,
      );
  return problems;
}

/**
 * `<parallel title>: branches both save "x"`, once per output name two branches
 * save. A node two branches both reach before the meet counts for the first only.
 */
function branchClashes(
  flow: FlowFile,
  parallel: FlowNodeModel,
  check: IoCheck,
): FlowProblem[] {
  const meet = meetOf(flow, parallel.id);
  const beyond = new Set(meet ? reachOrder(flow, meet) : []);
  const savedBy = new Map<string, number>();
  const counted = new Set<string>();
  for (const e of flow.edges.filter((x) => x.source === parallel.id)) {
    const names = new Set(
      reachOrder(flow, e.target)
        .filter((id) => {
          if (beyond.has(id) || counted.has(id)) return false;
          counted.add(id);
          return true;
        })
        .flatMap((id) => {
          const n = flow.nodes.find((x) => x.id === id);
          return n ? declaredOutputs(n, check.facts) : [];
        }),
    );
    for (const name of names) savedBy.set(name, (savedBy.get(name) ?? 0) + 1);
  }
  return [...savedBy]
    .filter(([, count]) => count > 1)
    .map(([name]) => ({
      level: "error" as const,
      nodeId: parallel.id,
      message: `${check.titleOf(parallel)}: branches both save "${name}"`,
    }));
}
