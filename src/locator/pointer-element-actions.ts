import type { ActionOptions } from "./actionability.js";
import type { ElementAccess } from "./element-access.js";
import type { CheckName } from "./element-state.js";
import { withModifiers } from "./key-actions.js";
import { modifierCodes, type Modifier } from "./key-map.js";
import {
  checkClick,
  pointerClick,
  pointerMoveTo,
  pointerTap,
  pointInRect,
  type Point,
  type PointerClickOptions,
} from "./pointer-actions.js";
import { CLICK_CHECKS, HOVER_CHECKS } from "./page-scripts.js";

export interface PointerOptions extends ActionOptions {
  /** Where on the element to point: pixels from its top left corner (default: the centre) */
  position?: Point;
  /** Keys held down during the action */
  modifiers?: Modifier[];
}

export interface ClickOptions extends PointerOptions, PointerClickOptions {}

/** Checks `position` and `modifiers`; `method` names the public method for the error */
function checkOptions(method: string, options: PointerOptions | undefined) {
  const position = options?.position;
  if (
    position !== undefined &&
    !(Number.isFinite(position.x) && Number.isFinite(position.y))
  ) {
    throw new Error(`${method}(): position must be { x, y } in pixels`);
  }
  return modifierCodes(options?.modifiers ?? [], undefined, method);
}

/** Waits until the element passes `checks` (scrolled into view) and answers where on screen to point */
export async function pointAtElement(
  access: ElementAccess,
  method: string,
  checks: readonly CheckName[],
  options: PointerOptions | undefined,
): Promise<Point> {
  const state = await access.waitForActionable(
    method,
    checks,
    {
      scroll: true,
      hitTest: true,
      ...(options?.position && { at: options.position }),
    },
    options,
  );
  // "attached" is always required, so the box is present
  return pointInRect(state.box!, options?.position);
}

/** Waits until the element is attached, visible, stable, enabled and not covered, then clicks it with real pointer input */
export async function clickElement(
  access: ElementAccess,
  options?: ClickOptions,
  method = "click",
): Promise<void> {
  const modifiers = checkOptions(method, options);
  checkClick(options ?? {}, method);
  const point = await pointAtElement(access, method, CLICK_CHECKS, options);
  await withModifiers(access.connector, access.contextId, modifiers, () =>
    pointerClick(access.connector, access.contextId, point, options, method),
  );
}

/** Waits until the element is attached, visible, stable and not covered, then moves the mouse onto it */
export async function hoverElement(
  access: ElementAccess,
  options?: PointerOptions,
): Promise<void> {
  const modifiers = checkOptions("hover", options);
  const point = await pointAtElement(access, "hover", HOVER_CHECKS, options);
  await withModifiers(access.connector, access.contextId, modifiers, () =>
    pointerMoveTo(access.connector, access.contextId, point),
  );
}

/** Waits like `click`, then touches the element with a finger (a touch pointer, not the mouse) */
export async function tapElement(
  access: ElementAccess,
  options?: PointerOptions,
): Promise<void> {
  const modifiers = checkOptions("tap", options);
  const point = await pointAtElement(access, "tap", CLICK_CHECKS, options);
  await withModifiers(access.connector, access.contextId, modifiers, () =>
    pointerTap(access.connector, access.contextId, point),
  );
}
