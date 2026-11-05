import { bindOutput } from "../wait/output-sink.js";
import {
  takeScreenshot,
  type ElementScreenshotOptions,
} from "../browser/screenshot.js";
import type { ActionOptions } from "./actionability.js";
import {
  callOnElement,
  callOnExistingElement,
  requireElement,
  type ElementAccess,
} from "./element-access.js";
import { clickRect } from "./pointer-actions.js";
import { DEFAULT_PAUSE_MS, pause, typeText } from "./input-actions.js";
import { chordSteps, performKeys, textSteps } from "./key-actions.js";
import { NAMED_KEYS, parseKeyChord } from "./key-map.js";
import {
  ATTACHED_ONLY,
  FILL_CHECKS,
  PRESS_CHECKS,
  SCREENSHOT_CHECKS,
} from "./page-scripts.js";

/** Takes a screenshot of just the element, after scrolling it into view and waiting until it is attached and visible */
export async function screenshotElement(
  access: ElementAccess,
  options: ElementScreenshotOptions & { timeout?: number } = {},
): Promise<Buffer> {
  const { timeout, ...capture } = options;
  await access.waitForActionable(
    "screenshot",
    SCREENSHOT_CHECKS,
    { scroll: true, hitTest: false },
    timeout === undefined ? undefined : { timeout },
  );
  const el = await requireElement(access);
  return takeScreenshot(access.connector, access.contextId, capture, {
    sharedId: el.sharedId,
  });
}

/** Waits until the element is attached, then focuses it */
export async function focusElement(
  access: ElementAccess,
  options?: ActionOptions,
): Promise<void> {
  await access.waitForActionable(
    "focus",
    ATTACHED_ONLY,
    { scroll: false, hitTest: false },
    options,
  );
  await callOnExistingElement(access, `el.focus();`);
}

/** Waits until the element is attached, visible and enabled and focuses it; the keys then go to the page's keyboard */
async function focusForKeys(
  access: ElementAccess,
  method: string,
  options: ActionOptions | undefined,
): Promise<void> {
  await access.waitForActionable(
    method,
    PRESS_CHECKS,
    { scroll: true, hitTest: false },
    options,
  );
  await callOnElement(access, undefined, `el.focus();`);
}

/** Focuses the element and presses `key` with real keyboard input; `key` can be a chord such as `Control+a` */
export async function pressOnElement(
  access: ElementAccess,
  key: string,
  options?: ActionOptions & { delay?: number },
): Promise<void> {
  const chord = parseKeyChord(key, "press");
  await focusForKeys(access, "press", options);
  await performKeys(
    access.connector,
    access.contextId,
    chordSteps(chord, options?.delay),
  );
}

/** Focuses the element and types `text` into it one key press at a time, `delay` ms apart */
export async function pressSequentially(
  access: ElementAccess,
  text: string,
  options?: ActionOptions & { delay?: number },
): Promise<void> {
  await focusForKeys(access, "pressSequentially", options);
  await performKeys(
    access.connector,
    access.contextId,
    textSteps(text, options?.delay),
  );
}

/** Empties an input, textarea or editable element, as `fill("")` does */
export async function clearElement(
  access: ElementAccess,
  options?: ActionOptions,
): Promise<void> {
  await fillElement(access, "", options);
}

/** Waits until the field is editable and not covered, then replaces its value by typing `value`; an empty string clears it */
export async function fillElement(
  access: ElementAccess,
  value: string,
  options?: ActionOptions & { output?: string },
): Promise<void> {
  // Taken when the call starts, so a fill that outlives its test saves into that test's closed sink
  const save =
    options?.output === undefined
      ? undefined
      : bindOutput("fill()", options.output);
  const state = await access.waitForActionable(
    "fill",
    FILL_CHECKS,
    { scroll: true, hitTest: true },
    options,
  );

  // Typing over the selected existing value replaces it; Backspace clears it for an empty value
  const keys = value === "" ? NAMED_KEYS.Backspace! : value;

  await clickRect(access.connector, access.contextId, state.box!);

  // Lets the focus the click caused (and the page's focus handlers) settle before the text is selected and typed over
  await pause(access.connector, access.contextId, DEFAULT_PAUSE_MS);

  await callOnElement(
    access,
    undefined,
    `if (typeof el.select === "function") el.select();`,
  );

  await typeText(access.connector, access.contextId, keys);
  save?.(value);
}
