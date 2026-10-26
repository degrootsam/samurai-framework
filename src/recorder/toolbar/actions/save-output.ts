import { matchesText } from "../../../assert/text-match.js";
import { RESERVED_OUTPUTS } from "../../../flows/core/steps.js";
import type { ActionReply } from "../protocol.js";
import type { ActionContext, Of } from "../types.js";
import { fail, PAUSED } from "./reply.js";

/** An output's name, as `test()` takes it */
const NAME = /^[A-Za-z_]\w*$/;

/**
 * Turns the Save as output panel's choice into a `saveOutput` step for the element that was picked. Refuses a
 * name `test()` would reject, and a pattern that isn't valid or doesn't match the element's text as picked.
 */
export async function saveOutputAction(
  ctx: ActionContext,
  message: Of<"save-output">,
): Promise<ActionReply> {
  if (ctx.isPaused()) return fail(PAUSED);
  const pick = ctx.pick();
  if (!pick || pick.id !== message.id) return fail("Pick the element again");
  const name = String(message.name ?? "").trim();
  if (!NAME.test(name) || RESERVED_OUTPUTS.includes(name))
    return fail("name: use letters, digits and _", "name");
  const source = String(message.pattern ?? "").trim();
  if (source !== "") {
    let pattern: RegExp;
    try {
      pattern = new RegExp(source);
    } catch {
      return fail("pattern is not a valid regular expression");
    }
    if (!matchesText(pick.text, pattern, "exact"))
      return fail("pattern doesn't match the element's text");
  }
  ctx.setPick(undefined);
  ctx.deps.observe({
    type: "saveOutput",
    locator: pick.locator,
    name,
    ...(source !== "" && { pattern: { source, flags: "" } }),
  });
  return { ok: true };
}
