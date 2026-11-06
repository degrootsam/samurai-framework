import { parsePlan } from "./plan-file.js";

/**
 * The plan's open questions as a prompt section: the answered ones with their answers, then the unanswered ones,
 * which the agent may `ask` the person. Empty when the plan has none or cannot be read.
 */
export function questionsSection(planText: string): string {
  let plan: ReturnType<typeof parsePlan>;
  try {
    plan = parsePlan(planText);
  } catch {
    return "";
  }
  const answered = new Set(plan.answers.map((entry) => entry.question));
  const open = plan.questions.filter((question) => !answered.has(question));
  const parts: string[] = [];
  if (plan.answers.length > 0)
    parts.push(
      `Questions the person has answered (use the answers, do not ask again):\n${plan.answers.map((entry) => `- ${entry.question}\n  Answer: ${entry.answer}`).join("\n")}`,
    );
  if (open.length > 0)
    parts.push(
      `Questions still open (call ask if you need the answer, do not guess):\n${open.map((question) => `- ${question}`).join("\n")}`,
    );
  return parts.join("\n\n");
}
