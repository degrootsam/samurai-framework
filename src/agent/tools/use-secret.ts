import { z } from "zod";
import { registerSecret } from "../../config/mask.js";
import { writtenText } from "../recording.js";
import { defineTool } from "./context.js";

export const useSecret = defineTool({
  name: "useSecret",
  description:
    "Type a secret (a password, a token) into the field that has focus. You only ever see the secret's name: " +
    "the value is filled in locally and never shown to you. Click the field first. Only the listed secrets exist.",
  inputSchema: z.object({
    name: z.string().min(1).describe("The secret's name, for example PASSWORD"),
  }),
  async execute({ name }, context) {
    const { allowed } = context.secrets;
    if (!allowed.includes(name))
      return {
        ok: false,
        error: `useSecret(): the secret ${name} is not available to the agent${allowed.length > 0 ? `; available: ${allowed.join(", ")}` : " (none are)"}. Ask the person instead`,
      };
    const value = context.secrets.get(name);
    if (value === undefined || value === "")
      return {
        ok: false,
        error: `useSecret(): the secret ${name} has no value in this environment; ask the person to set it`,
      };
    registerSecret(name, value);
    const located = await context.snapshots.locateFocused();
    await located.locator.fill(value, { timeout: context.actionTimeout });
    // Written as `secrets.NAME`, not the value
    const events = context.steps.observe({
      type: "insert",
      locator: located.spec,
      value: { kind: "secret", name },
    });
    if (!located.dotted) context.secretOnScreen = true;
    return {
      ok: true,
      message: `Filled ${located.description} with the secret ${name}.${writtenText(events)}`,
    };
  },
});
