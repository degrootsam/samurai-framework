import { z } from "zod";
import { defineTool } from "./context.js";
import { writtenText } from "../recording.js";
import { leftAllowedOrigins } from "./origin-guard.js";

const ASK_ALLOW = "allow";

export const navigate = defineTool({
  name: "navigate",
  description:
    "Open a URL, or a path on the current site (for example /login). Only the site the test started on is allowed; " +
    "any other origin asks the person first, and it can be refused.",
  inputSchema: z.object({
    url: z
      .string()
      .min(1)
      .describe("An absolute http(s) URL, or a path such as /login"),
  }),
  async execute({ url }, context) {
    let target: URL;
    try {
      const current = await context.page.url();
      target = new URL(
        url,
        /^https?:/.test(current) ? current : context.origins.base,
      );
    } catch {
      return {
        ok: false,
        error: `navigate(): "${url}" is not a valid URL or path`,
      };
    }
    if (target.protocol !== "http:" && target.protocol !== "https:")
      return {
        ok: false,
        error: `navigate(): only http and https pages can be opened, not ${target.protocol}`,
      };
    if (!context.origins.isAllowed(target)) {
      const answer = await context.ask(
        `The agent wants to open ${target.origin}, which is not one of the allowed sites (${context.origins.list().join(", ")}). Allow it?`,
        [ASK_ALLOW, "deny"],
      );
      if (answer.trim().toLowerCase() !== ASK_ALLOW)
        return {
          ok: false,
          error: `navigate(): ${target.origin} is not allowed; the person declined. Stay on ${context.origins.list().join(", ")}`,
        };
      context.origins.allow(target);
    }
    const before = await context.page.url();
    await context.page.goto(target.href);
    const problem = await leftAllowedOrigins(context, before);
    if (problem) return { ok: false, error: `navigate(): ${problem}` };
    const events = context.steps.observe({ type: "goto", url: target.href });
    return {
      ok: true,
      message: `Opened ${await context.page.url()}.${writtenText(events)}`,
    };
  },
});
