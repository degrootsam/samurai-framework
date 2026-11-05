import type { ActionOptions } from "./actionability.js";
import type { ElementAccess } from "./element-access.js";
import {
  pointAtElement,
  type PointerOptions,
} from "./pointer-element-actions.js";
import { HOVER_CHECKS, CLICK_CHECKS } from "./page-scripts.js";
import { pointerDrag, type Point } from "./pointer-actions.js";

export interface DragOptions extends ActionOptions {
  /** Where on the dragged element to press: pixels from its top left corner (default: the centre) */
  sourcePosition?: Point;
  /** Where on the target to release (default: the centre) */
  targetPosition?: Point;
  /** Pointer moves between the two points (default 10) */
  steps?: number;
}

const DEFAULT_STEPS = 10;
const STATE = `globalThis[Symbol.for("samurai.drag")]`;

/** Starts watching the drag events of the document, to tell afterwards how far a native drag got */
const WATCH_DRAG = `() => {
  const state = { started: false, dropped: false, data: [], off: [] };
  const on = (target, type, fn, capture) => {
    target.addEventListener(type, fn, capture);
    state.off.push(() => target.removeEventListener(type, fn, capture));
  };
  on(document, "dragstart", () => { state.started = true; }, true);
  on(document, "drop", () => { state.dropped = true; }, true);
  // Bubbling to the window comes after the page's own dragstart handlers, so what they put in the data is there
  on(window, "dragstart", (event) => {
    const dt = event.dataTransfer;
    for (const type of dt ? Array.from(dt.types) : []) {
      if (type !== "Files") state.data.push([type, dt.getData(type)]);
    }
  }, false);
  ${STATE} = state;
}`;

/**
 * Stops watching. When the browser began a native drag but never dropped (Firefox does this with
 * synthetic pointer input), or the source is \`draggable\` and no drag began, fires the rest of the sequence as
 * synthetic events with a DataTransfer that carries what the page's dragstart handler stored.
 */
const FINISH_DRAG = `(source, target, from, to, moved) => {
  const state = ${STATE};
  delete ${STATE};
  if (!state) return;
  state.off.forEach((off) => off());
  if (state.dropped || !moved) return;
  if (!state.started && !source.closest('[draggable="true"]')) return;
  const data = new DataTransfer();
  for (const [type, value] of state.data) data.setData(type, value);
  const fire = (el, type, at) => el.dispatchEvent(new DragEvent(type, {
    bubbles: true, cancelable: true, composed: true, dataTransfer: data, clientX: at.x, clientY: at.y,
  }));
  if (!state.started && !fire(source, "dragstart", from)) return;
  if (!state.started) fire(target, "dragenter", to);
  // A drop is only allowed where dragover was cancelled, as in a real drag
  if (fire(target, "dragover", to)) { fire(source, "dragend", to); return; }
  fire(target, "drop", to);
  fire(source, "dragend", to);
}`;

/**
 * Presses on the element, moves to `target` in steps and releases there, with real pointer input. Both ends
 * wait like a click does. Chrome runs a real HTML5 drag; Firefox starts one but never drops it from
 * synthetic pointer input, so the drop (and `dragend`) are then fired as synthetic events (`isTrusted` false).
 */
export async function dragElement(
  access: ElementAccess,
  target: ElementAccess,
  options: DragOptions = {},
): Promise<void> {
  const {
    sourcePosition,
    targetPosition,
    steps = DEFAULT_STEPS,
    ...wait
  } = options;
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error("dragTo(): steps must be a whole number, 1 or more");
  }
  const sourceOptions: PointerOptions = {
    ...wait,
    ...(sourcePosition && { position: sourcePosition }),
  };
  const targetOptions: PointerOptions = {
    ...wait,
    ...(targetPosition && { position: targetPosition }),
  };
  // The target first: scrolling it into view may move the source, which is probed last
  const to = await pointAtElement(
    target,
    "dragTo",
    HOVER_CHECKS,
    targetOptions,
  );
  const from = await pointAtElement(
    access,
    "dragTo",
    CLICK_CHECKS,
    sourceOptions,
  );
  const source = await access.requireElement();
  const destination = await target.requireElement();
  await access.call(WATCH_DRAG, []);
  let moved = false;
  try {
    await pointerDrag(access.connector, access.contextId, from, to, steps);
    moved = true;
  } finally {
    await access.call(FINISH_DRAG, [source, destination, from, to, moved]);
  }
}
