import type { Expectation } from "../../../steps/model.js";
import type { ActionReply } from "../protocol.js";
import type { ActionContext, Of } from "../types.js";
import { fail, PAUSED } from "./reply.js";

/** Turns the Assert panel's choice into an `expect` step for the element that was picked */
export async function assertAction(
  ctx: ActionContext,
  message: Of<"assert">,
): Promise<ActionReply> {
  if (ctx.isPaused()) return fail(PAUSED);
  const pick = ctx.pick();
  if (!pick || pick.id !== message.id) return fail("Pick the element again");
  let locator = pick.locator;
  let expectation: Expectation;
  const expected = String(message.expected ?? "");
  switch (message.matcher) {
    case "toBeVisible":
      expectation = { matcher: "toBeVisible" };
      break;
    case "toHaveText":
    case "toContainText":
    case "toHaveValue":
      expectation = { matcher: message.matcher, expected };
      break;
    case "toHaveAttribute":
      if (!message.attribute) return fail("Choose an attribute");
      expectation = {
        matcher: "toHaveAttribute",
        name: message.attribute,
        expected,
      };
      break;
    case "toHaveCount": {
      const call = pick.counts[message.countIndex ?? 0];
      const count = Number(expected);
      if (!call) return fail("Choose what to count");
      if (expected.trim() === "" || !Number.isInteger(count) || count < 0)
        return fail("A count is a whole number");
      locator = { chain: [call], fallbacks: [] };
      expectation = { matcher: "toHaveCount", expected: count };
      break;
    }
    default:
      return fail("Choose a matcher");
  }
  ctx.setPick(undefined);
  ctx.deps.observe({
    type: "expect",
    locator,
    not: message.not === true,
    expectation,
  });
  return { ok: true };
}
