import { evaluateText, KEY_PATTERN } from "../../core/index.js";
import { fail, problemAt, type Handler } from "./support.js";

export const setVariable: Handler = async (node, run) => {
  const name = node.config?.name;
  if (typeof name !== "string" || !KEY_PATTERN.test(name))
    return {
      status: "failed",
      error: "Give the variable a name: lowercase letters, digits and _.",
    };
  const text = String(node.config?.value ?? "");
  const problem = problemAt(node, run, text);
  if (problem) return { status: "failed", error: problem };
  try {
    const value = evaluateText(text, run.context);
    run.context.vars[name] = value;
    return { status: "passed", wrote: { [name]: value } };
  } catch (e) {
    return fail(e);
  }
};
