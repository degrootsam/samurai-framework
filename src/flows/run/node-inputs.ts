import { evaluateText, wiringAt, type FlowNodeModel } from "../core/index.js";
import type { NodeTest } from "./events.js";
import type { HandlerRun, Outcome } from "./handlers/types.js";
import { problemAt, runNodeTests } from "./handlers/support.js";

/** What a node's title is in a message: its title, else its key, else its id */
const titleOf = (node: FlowNodeModel | undefined, id: string) =>
  node?.title || node?.key || id;

/** The value of an override expression as an input: text as is, a number or a boolean as text, else an error */
function expressionValue(
  node: FlowNodeModel,
  run: HandlerRun,
  expression: string,
): { value: string } | { error: string } {
  const problem = problemAt(node, run, expression);
  if (problem) return { error: problem };
  let value: unknown;
  try {
    value = evaluateText(expression, run.context);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (typeof value === "string") return { value };
  if (typeof value === "number" || typeof value === "boolean")
    return { value: String(value) };
  return { error: "the expression gave no text" };
}

/**
 * The values a Test or Group node sends for its inputs, by `wiringAt`: an earlier node's saved output, an override
 * expression's value, nothing for "use the default". An input whose source saved nothing, an override that gives
 * no text, or an input with no source is an error, and the node's tests must not run.
 */
function resolveNodeInputs(
  node: FlowNodeModel,
  run: HandlerRun,
): { inputs: Record<string, string> } | { error: string } {
  const inputs: Record<string, string> = {};
  const wiring = wiringAt(run.flow, node.id, {
    ...(run.facts && { facts: run.facts }),
  });
  for (const [name, source] of Object.entries(wiring)) {
    if (source.from === "default") continue;
    if (source.from === "none")
      return { error: `input "${name}" has no source` };
    if (source.from === "node") {
      const value = run.outputsById[source.nodeId]?.[source.output];
      if (typeof value !== "string") {
        const producer = run.flow.nodes.find((n) => n.id === source.nodeId);
        return {
          error: `input "${name}": ${titleOf(producer, source.nodeId)} saved no ${source.output}`,
        };
      }
      inputs[name] = value;
      continue;
    }
    const result = expressionValue(node, run, source.expression);
    if ("error" in result) return { error: `input "${name}": ${result.error}` };
    inputs[name] = result.value;
  }
  return { inputs };
}

/** Runs a Test or Group node's tests with the inputs it resolves; an input that can't be resolved fails the node */
export function runWiredTests(
  node: FlowNodeModel,
  run: HandlerRun,
  list: NodeTest[],
): Promise<Outcome> {
  const resolved = resolveNodeInputs(node, run);
  if ("error" in resolved)
    return Promise.resolve({ status: "failed", error: resolved.error });
  return runNodeTests(node, run, list, resolved.inputs);
}
