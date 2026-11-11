import { z } from "zod";
import { writtenText } from "../recording.js";
import { defineTool } from "./context.js";

/** The longest fixed wait the agent writes (ms): a test that needs more should wait for something instead */
const MAX_MS = 30000;

export const wait = defineTool({
  name: "wait",
  description:
    "Add a wait step to the test: `networkIdle` (until the page has no requests in flight) or `time` (a fixed " +
    "number of milliseconds). The test already waits for elements and navigations by itself, and expect waits for " +
    "what it checks, so use this only when the person asks for a wait or nothing else can be waited for. " +
    "The wait also runs now, on the live page.",
  inputSchema: z.object({
    for: z.enum(["networkIdle", "time"]),
    ms: z
      .number()
      .int()
      .min(0)
      .max(MAX_MS)
      .optional()
      .describe(`With time: how long, in milliseconds (at most ${MAX_MS})`),
  }),
  async execute({ for: what, ms }, context) {
    if (what === "time") {
      if (ms === undefined)
        return {
          ok: false,
          error: "wait(): time needs ms, the milliseconds to wait",
        };
      await context.page.waitForTimeout(ms);
      const events = context.steps.observe({ type: "wait-time", ms });
      return { ok: true, message: `Waited ${ms} ms.${writtenText(events)}` };
    }
    if (ms !== undefined)
      return {
        ok: false,
        error: "wait(): ms is only for time; networkIdle takes no ms",
      };
    await context.page.waitForNetworkIdle({ timeout: context.actionTimeout });
    const events = context.steps.observe({ type: "wait-idle" });
    return { ok: true, message: `The network is idle.${writtenText(events)}` };
  },
});
