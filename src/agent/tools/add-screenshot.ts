import { z } from "zod";
import { writtenText } from "../recording.js";
import { defineTool } from "./context.js";

/** What a screenshot name may be: the characters the saved file keeps (`cleanName` turns the rest into `-`) */
const NAME = /^[A-Za-z0-9_-]{1,60}$/;

/** Adds a `screenshot` step. `screenshot` (the vision tool) is how the model looks; this is what the test saves */
export const addScreenshot = defineTool({
  name: "addScreenshot",
  description:
    "Add a step to the test that saves a picture of the page, named `name`, every time the test runs. " +
    "Use it when the person asks for a screenshot in the test. It writes the step only: no picture is taken now and " +
    "you do not see one (use screenshot to look at the page).",
  inputSchema: z.object({
    name: z
      .string()
      .describe(
        "The picture's file name: letters, digits, - and _, at most 60 characters (for example after-login)",
      ),
    fullPage: z
      .boolean()
      .optional()
      .describe("The whole page instead of what is in view"),
  }),
  async execute({ name, fullPage }, context) {
    if (!NAME.test(name))
      return {
        ok: false,
        error:
          "addScreenshot(): name must be 1 to 60 characters, only letters, digits, - and _ (for example after-login)",
      };
    const events = context.steps.observe({
      type: "screenshot",
      name,
      fullPage: fullPage === true,
    });
    return {
      ok: true,
      message: `Screenshot step added; the picture is saved when the test runs, none was taken now.${writtenText(events)}`,
    };
  },
});
