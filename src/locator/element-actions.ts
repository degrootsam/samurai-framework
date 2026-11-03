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
import {
  clickRect,
  DEFAULT_PAUSE_MS,
  NAMED_KEYS,
  pause,
  pressKey,
  typeText,
} from "./input-actions.js";
import {
  ATTACHED_ONLY,
  CLICK_CHECKS,
  FILL_CHECKS,
  PRESS_CHECKS,
  SCREENSHOT_CHECKS,
} from "./page-scripts.js";

/** Waits until the element is attached, visible, stable, enabled and not covered, then clicks its centre with real pointer input */
export async function clickElement(
  access: ElementAccess,
  options?: ActionOptions,
): Promise<void> {
  const state = await access.waitForActionable(
    "click",
    CLICK_CHECKS,
    { scroll: true, hitTest: true },
    options,
  );
  // "attached" is always required, so the box is present
  await clickRect(access.connector, access.contextId, state.box!);
}

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

/** Waits until the element is attached, visible and enabled, focuses it and presses `key` with real keyboard input */
export async function pressOnElement(
  access: ElementAccess,
  key: string,
  options?: ActionOptions,
): Promise<void> {
  const code = NAMED_KEYS[key] ?? (Array.from(key).length === 1 ? key : "");
  if (code === "") {
    throw new Error(
      `press(): unknown key "${key}". Use one of ${Object.keys(NAMED_KEYS).join(", ")} or a single character`,
    );
  }
  await access.waitForActionable(
    "press",
    PRESS_CHECKS,
    { scroll: true, hitTest: false },
    options,
  );
  await callOnElement(access, undefined, `el.focus();`);
  await pressKey(access.connector, access.contextId, code);
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
