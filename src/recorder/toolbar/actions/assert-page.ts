import { urlForAssertion } from "../../expectation.js";
import type { ActionReply, PageInfo } from "../protocol.js";
import type { ActionContext, ControllerDeps, Of } from "../types.js";
import { holdsSecret } from "./pick.js";
import { fail, PAUSED } from "./reply.js";

/** What the Page panel offers: the recorded page's URL (relative to the base URL when it can be) and title */
export async function pageInfoOf(
  deps: ControllerDeps,
  secrets: Map<string, string | undefined>,
): Promise<PageInfo> {
  const { url, title } = await deps.pageInfo();
  const secret = holdsSecret(secrets);
  // A secret never reaches the page: a URL or title holding one is left out
  const clean = (text: string) => (secret(text) ? "" : text);
  return {
    ok: true,
    url: clean(url),
    urlPrefill: clean(urlForAssertion(url, deps.baseURL)),
    title: clean(title),
  };
}

/** Turns the Page panel's choice into an `expectPage` step */
export async function assertPageAction(
  ctx: ActionContext,
  message: Of<"assert-page">,
): Promise<ActionReply> {
  if (ctx.isPaused()) return fail(PAUSED);
  const { matcher } = message;
  if (matcher !== "toHaveURL" && matcher !== "toHaveTitle")
    return fail("Choose a matcher");
  const expected = String(message.expected ?? "");
  if (expected.trim() === "") return fail("Fill in the value");
  ctx.deps.observe({
    type: "expectPage",
    not: message.not === true,
    expectation: { matcher, expected },
  });
  return { ok: true };
}
