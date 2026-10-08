import { evaluateText } from "../../core/index.js";
import { fail, problemAt, type Handler } from "./support.js";

export const condition: Handler = async (node, run) => {
  const text = String(node.config?.expr ?? "");
  const problem = problemAt(node, run, text);
  if (problem) return { status: "failed", error: problem };
  try {
    return {
      status: "passed",
      branch: evaluateText(text, run.context) ? "true" : "false",
    };
  } catch (e) {
    return fail(e);
  }
};
