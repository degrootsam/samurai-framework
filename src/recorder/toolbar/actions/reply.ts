import { IO_NAME, isIoName } from "../../../flows/core/steps.js";
import type { ActionReply } from "../protocol.js";

export const UNIDENTIFIABLE = "This element can't be identified uniquely";
export const TYPE_FAILED = "Couldn't type into that field";
export const NO_ENVIRONMENT = "This recording has no environment";
export const PAUSED = "Nothing you do now is recorded.";

/** A refusal the toolbar shows; `field` names the form field to mark */
export const fail = (error: string, field?: "name"): ActionReply => ({
  ok: false,
  error,
  ...(field && { field }),
});

/** What is wrong with `name` as an input or output name, as the name field shows it; undefined when nothing is */
export function nameProblem(name: string): string | undefined {
  if (isIoName(name)) return undefined;
  return IO_NAME.test(name)
    ? `name: ${JSON.stringify(name)} is reserved`
    : "name: use letters, digits and _";
}
