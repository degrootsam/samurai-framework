import { z } from "zod";
import { defineTool } from "./context.js";

export const screenshot = defineTool({
  name: "screenshot",
  description:
    "Look at the page as an image, for what the text snapshot cannot tell (layout, colours, charts). " +
    "It is not added to the test.",
  inputSchema: z.object({
    fullPage: z
      .boolean()
      .optional()
      .describe("The whole page instead of what is in view"),
  }),
  async execute({ fullPage }, context) {
    if (!context.vision)
      return {
        ok: false,
        error: "screenshot(): this model cannot look at images; use snapshot",
      };
    if (context.secretOnScreen)
      return {
        ok: false,
        error:
          "screenshot(): a secret was typed into a field the page shows in plain text, so images are off for this run; use snapshot",
      };
    const marked = await context.snapshots.secretOnScreen();
    if (marked !== undefined)
      return {
        ok: false,
        error: `screenshot(): the page shows the value of a field marked secret (${marked}), so no image is taken; use snapshot`,
      };
    const image = await context.page.screenshot({
      fullPage: fullPage === true,
    });
    return {
      ok: true,
      message: "Screenshot attached.",
      image: { mediaType: "image/png", data: image.toString("base64") },
    };
  },
});
