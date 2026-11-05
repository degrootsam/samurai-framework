import type { ActionOptions } from "./actionability.js";
import { callOnExistingElement, type ElementAccess } from "./element-access.js";
import { clickRect } from "./pointer-actions.js";
import { ATTACHED_ONLY, CLICK_CHECKS } from "./page-scripts.js";

export interface CheckOptions extends ActionOptions {
  /** Wait for the element to be actionable, but do not click (and so do not change anything) */
  trial?: boolean;
}

/** Which of the three public methods asked, for the messages */
type CheckMethod = "check" | "uncheck" | "setChecked";

interface ControlInfo {
  /** "checkbox" (a checkbox, switch or menuitemcheckbox), "radio", or null for anything else */
  kind: "checkbox" | "radio" | null;
  checked: boolean;
}

/** Body run in the page as `(el) => { ... }`: what kind of control the element is, and whether it is checked */
const CONTROL_INFO_BODY = `
  const type = (el.getAttribute("type") || "").toLowerCase();
  const role = (el.getAttribute("role") || "").trim().split(/\\s+/)[0].toLowerCase();
  let kind = null;
  if (el.tagName === "INPUT" && (type === "checkbox" || type === "radio")) kind = type;
  else if (role === "checkbox" || role === "switch" || role === "menuitemcheckbox") kind = "checkbox";
  else if (role === "radio" || role === "menuitemradio") kind = "radio";
  const native = el.tagName === "INPUT" && (type === "checkbox" || type === "radio");
  return { kind, checked: native ? el.checked : el.getAttribute("aria-checked") === "true" };`;

function readControl(
  access: ElementAccess,
  method: CheckMethod,
): Promise<ControlInfo> {
  return callOnExistingElement<ControlInfo>(access, CONTROL_INFO_BODY, method);
}

/**
 * Brings a checkbox, radio or `role=checkbox|radio|switch` element to `checked`. Already there: nothing is clicked.
 * Otherwise waits until the control (or one of its labels, for a hidden input) can be clicked, clicks it with real
 * pointer input and verifies the state changed.
 */
export async function setChecked(
  access: ElementAccess,
  method: CheckMethod,
  checked: boolean,
  options?: CheckOptions,
): Promise<void> {
  const { trial, ...action } = options ?? {};
  await access.waitForActionable(
    method,
    ATTACHED_ONLY,
    { scroll: false, hitTest: false },
    action,
  );
  const before = await readControl(access, method);
  if (before.kind === null) {
    throw new Error(
      `${method}(): element is not a checkbox, radio, or role=checkbox/radio/switch`,
    );
  }
  if (before.checked === checked) return;
  if (before.kind === "radio" && !checked) {
    throw new Error(`${method}(): a radio button cannot be unchecked`);
  }

  const state = await access.waitForActionable(
    method,
    // The same checks as a click; the probe's `control` mode decides what counts as the target
    CLICK_CHECKS,
    { scroll: true, hitTest: true, control: true },
    action,
  );
  if (trial) return;
  // "attached" is always required, so the box is present
  await clickRect(access.connector, access.contextId, state.box!);

  if ((await readControl(access, method)).checked !== checked) {
    throw new Error(
      `${method}(): clicking the ${before.kind} did not change its state`,
    );
  }
}
