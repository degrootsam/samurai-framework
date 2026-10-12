import { evaluateText, getPath, withDefaults } from "../core/index.js";
import { fail, problemAt, type Handler } from "../run/handlers/support.js";
import { stepNode, type StepDefinition, type StepResult } from "./define.js";

const keysOf = (o: Record<string, unknown> | undefined) => Object.keys(o ?? {});

/** The one handler every step runs through */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stepHandler(step: StepDefinition<any>): Handler {
  const def = stepNode(step);
  return async (node, run) => {
    const typed = withDefaults(def, node);
    const config: Record<string, unknown> = { ...typed.config };
    for (const f of step.fields) {
      if (f.type !== "expression") continue;
      const text = String(getPath(typed, f.path) ?? "");
      const problem = problemAt(node, run, text);
      if (problem) return { status: "failed", error: problem };
      try {
        config[f.path.slice("config.".length)] = evaluateText(
          text,
          run.context,
        );
      } catch (e) {
        return fail(e);
      }
    }

    // A step that ignores the signal must not hold the run: Stop wins the race
    const stopped = new Promise<"stopped">((resolve) => {
      if (run.signal.aborted) resolve("stopped");
      run.signal.addEventListener("abort", () => resolve("stopped"), {
        once: true,
      });
    });
    let result: StepResult | void | "stopped";
    try {
      result = await Promise.race([
        step.run({
          config,
          env: { ...run.context.env },
          vars: { ...run.context.vars },
          node: {
            id: node.id,
            ...(node.key && { key: node.key }),
            ...(node.title && { title: node.title }),
          },
          signal: run.signal,
          sleep: (ms) => run.sleep(ms, run.signal),
          log: (level, text) => run.log(node.id, level, text),
        }),
        stopped,
      ]);
    } catch (e) {
      if (run.signal.aborted) return "cancelled";
      return fail(e);
    }
    if (result === "stopped" || run.signal.aborted) return "cancelled";

    const declared = new Set((step.outputs ?? []).map((o) => o.name));
    const extra = keysOf(result?.outputs).filter((k) => !declared.has(k));
    if (extra.length)
      return {
        status: "failed",
        error: `${step.label} returned outputs it doesn't declare: ${extra.join(", ")}.`,
      };
    const allowed = step.writesVar ? getPath(typed, step.writesVar) : undefined;
    const wrongVars = keysOf(result?.vars).filter((k) => k !== allowed);
    if (wrongVars.length)
      return {
        status: "failed",
        error: `${step.label} wrote variables it doesn't declare: ${wrongVars.join(", ")}.`,
      };

    Object.assign(run.context.vars, result?.vars);
    return {
      status: "passed",
      ...(keysOf(result?.outputs).length > 0 && { outputs: result!.outputs }),
      ...(keysOf(result?.vars).length > 0 && { wrote: result!.vars }),
      ...(result?.note && { note: result.note }),
    };
  };
}
