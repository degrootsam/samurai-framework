import type { ActionOptions } from "./actionability.js";
import { callOnExistingElement, type ElementAccess } from "./element-access.js";
import { ATTACHED_ONLY } from "./page-scripts.js";

/** Waits until the element is attached, then removes focus from it */
export async function blurElement(
  access: ElementAccess,
  options?: ActionOptions,
): Promise<void> {
  await access.waitForActionable(
    "blur",
    ATTACHED_ONLY,
    { scroll: false, hitTest: false },
    options,
  );
  await callOnExistingElement(access, `el.blur();`);
}

// The event interface each type is made with; any other type is a plain Event
const EVENT_CLASSES: Readonly<Record<string, string[]>> = {
  MouseEvent: [
    "click",
    "dblclick",
    "auxclick",
    "contextmenu",
    "mousedown",
    "mouseup",
    "mousemove",
    "mouseover",
    "mouseout",
    "mouseenter",
    "mouseleave",
  ],
  PointerEvent: [
    "pointerdown",
    "pointerup",
    "pointermove",
    "pointerover",
    "pointerout",
    "pointerenter",
    "pointerleave",
    "pointercancel",
    "gotpointercapture",
    "lostpointercapture",
  ],
  KeyboardEvent: ["keydown", "keyup", "keypress"],
  FocusEvent: ["focus", "blur", "focusin", "focusout"],
  InputEvent: ["input", "beforeinput"],
  WheelEvent: ["wheel"],
  DragEvent: [
    "drag",
    "dragstart",
    "dragend",
    "dragenter",
    "dragover",
    "dragleave",
    "drop",
  ],
  CompositionEvent: ["compositionstart", "compositionupdate", "compositionend"],
  TouchEvent: ["touchstart", "touchend", "touchmove", "touchcancel"],
  AnimationEvent: ["animationstart", "animationend", "animationiteration"],
  TransitionEvent: [
    "transitionrun",
    "transitionstart",
    "transitionend",
    "transitioncancel",
  ],
};

/** Body run in the page as `(el, type, init, classes) => { ... }`: builds the event by its type and fires it at `el` */
const DISPATCH_BODY = `
  const name = Object.keys(classes).find((key) => classes[key].includes(type));
  const Ctor = (name && globalThis[name]) || Event;
  const init = Object.assign({ bubbles: true, cancelable: true, composed: true }, eventInit);
  if (name === "DragEvent" && !init.dataTransfer) init.dataTransfer = new DataTransfer();
  el.dispatchEvent(new Ctor(type, init));`;

/**
 * Waits until the element is attached, then fires a synthetic event of `type` at it (no scrolling, visibility or
 * enabled checks, as with a user it would not be reached). The event class follows the type; `eventInit`
 * (plain data) is merged over `bubbles`, `cancelable` and `composed`, which are all true.
 */
export async function dispatchEventOn(
  access: ElementAccess,
  type: string,
  eventInit: Record<string, unknown> = {},
  options?: ActionOptions,
): Promise<void> {
  if (type === "") throw new Error("dispatchEvent(): type must not be empty");
  await access.waitForActionable(
    "dispatchEvent",
    ATTACHED_ONLY,
    { scroll: false, hitTest: false },
    options,
  );
  const el = await access.requireElement();
  await access.call(`(el, type, eventInit, classes) => {${DISPATCH_BODY}}`, [
    el,
    type,
    eventInit,
    EVENT_CLASSES,
  ]);
}
