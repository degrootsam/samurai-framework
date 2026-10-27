import { captured, matchesText } from "../../../assert/text-match.js";
import type { ActionReply, OutputPreview } from "../protocol.js";
import type { ActionContext, Of } from "../types.js";
import { holdsSecret, maskSecrets } from "./pick.js";
import { fail, nameProblem, PAUSED } from "./reply.js";

const PICK_AGAIN = "Pick the element again";

/** A pattern as typed, compiled the way the step writes it; undefined when there is none, an error when it isn't valid */
function compile(pattern: unknown): RegExp | undefined | { error: string } {
  const source = String(pattern ?? "").trim();
  if (source === "") return undefined;
  try {
    return new RegExp(source);
  } catch {
    return { error: "pattern is not a valid regular expression" };
  }
}

/**
 * What Save as output would save from an element that shows a secret, worked out here because the page only has
 * its text masked: `outputs.save`'s rule (the first group, else the whole match, else the whole text) on the text
 * as picked, every secret masked, and whether the value held one. The errors read as the panel's own preview's.
 */
export function outputPreview(
  ctx: ActionContext,
  message: Of<"output-preview">,
): OutputPreview {
  const pattern = String(message.pattern ?? "");
  const answer = { preview: true as const, pattern };
  const pick = ctx.pick();
  if (!pick || pick.id !== message.id)
    return { ...answer, ok: false, error: PICK_AGAIN };
  const compiled = compile(pattern);
  if (compiled && !(compiled instanceof RegExp))
    return { ...answer, ok: false, error: "Not a valid pattern" };
  if (compiled && !matchesText(pick.text, compiled, "exact"))
    return { ...answer, ok: false, error: "No match" };
  const value = compiled ? captured(compiled, pick.text) : pick.text;
  return {
    ...answer,
    ok: true,
    value: maskSecrets(ctx.secrets)(value),
    secret: holdsSecret(ctx.secrets)(value),
  };
}

/**
 * Turns the Save as output panel's choice into a `saveOutput` step for the element that was picked. Refuses a
 * name `test()` would reject, an element with no text when there is no pattern, and a pattern that isn't valid
 * or doesn't match the element's text as picked, read the way `outputs.save` reads it. An element that shows a
 * secret is saved too: the panel warns that the output may hold it.
 */
export async function saveOutputAction(
  ctx: ActionContext,
  message: Of<"save-output">,
): Promise<ActionReply> {
  if (ctx.isPaused()) return fail(PAUSED);
  const pick = ctx.pick();
  if (!pick || pick.id !== message.id) return fail(PICK_AGAIN);
  const name = String(message.name ?? "").trim();
  const problem = nameProblem(name);
  if (problem) return fail(problem, "name");
  const pattern = compile(message.pattern);
  if (pattern && !(pattern instanceof RegExp)) return fail(pattern.error);
  if (pattern && !matchesText(pick.text, pattern, "exact"))
    return fail("pattern doesn't match the element's text");
  if (!pattern && pick.text === "") return fail("the element has no text");
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
