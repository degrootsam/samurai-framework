import { matchesText } from "../../../assert/text-match.js";
import type { ActionReply } from "../protocol.js";
import type { ActionContext, Of } from "../types.js";
import { holdsSecret } from "./pick.js";
import { fail, nameProblem, PAUSED } from "./reply.js";

/**
 * Turns the Save as output panel's choice into a `saveOutput` step for the element that was picked. Refuses an
 * element whose text holds a secret, a name `test()` would reject, an element with no text when there is no
 * pattern, and a pattern that isn't valid or doesn't match the element's text as picked, read the way
 * `outputs.save` reads it.
 */
export async function saveOutputAction(
  ctx: ActionContext,
  message: Of<"save-output">,
): Promise<ActionReply> {
  if (ctx.isPaused()) return fail(PAUSED);
  const pick = ctx.pick();
  if (!pick || pick.id !== message.id) return fail("Pick the element again");
  // The step would write the secret into the run's results
  if (holdsSecret(ctx.secrets)(pick.text))
    return fail("this element shows a secret; it can't be an output");
  const name = String(message.name ?? "").trim();
  const problem = nameProblem(name);
  if (problem) return fail(problem, "name");
  const source = String(message.pattern ?? "").trim();
  let pattern: RegExp | undefined;
  if (source !== "") {
    try {
      pattern = new RegExp(source);
    } catch {
      return fail("pattern is not a valid regular expression");
    }
    if (!matchesText(pick.text, pattern, "exact"))
      return fail("pattern doesn't match the element's text");
  } else if (pick.text === "") return fail("the element has no text");
  ctx.setPick(undefined);
  ctx.deps.observe({
    type: "saveOutput",
    locator: pick.locator,
    name,
    // The built pattern's source: a `/` comes out escaped, so the spec it is written into compiles
    ...(pattern && { pattern: { source: pattern.source, flags: "" } }),
  });
  return { ok: true };
}
