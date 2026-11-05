import type { BiDiConnector } from "../transport/bidi-connection.js";
import type {
  PointerButton,
  PointerSourceAction,
} from "../types/bidi-modules/input.js";
import { POINTER_ID } from "./input-actions.js";

export interface Point {
  x: number;
  y: number;
}

type Rect = Point & { width: number; height: number };

export type MouseButton = "left" | "middle" | "right";

/** What a click does beyond a plain left click */
export interface PointerClickOptions {
  button?: MouseButton;
  /** Presses in a row: 2 is a double click (default 1) */
  clickCount?: number;
  /** Milliseconds between a press and its release (default 0) */
  delay?: number;
}

const TOUCH_ID = "samurai-touch";
const WHEEL_ID = "samurai-wheel";
const BUTTONS: Readonly<Record<MouseButton, PointerButton>> = {
  left: 0,
  middle: 1,
  right: 2,
};

/** The BiDi number of a mouse button; `method` names the public method for the error */
export function buttonCode(
  button: MouseButton = "left",
  method: string,
): PointerButton {
  const code = BUTTONS[button];
  if (code === undefined) {
    throw new Error(
      `${method}(): unknown button "${button}". Use left, middle or right`,
    );
  }
  return code;
}

/** The viewport point `position` (from the rect's top left corner) names; the centre without one */
export function pointInRect(rect: Rect, position?: Point): Point {
  return position
    ? { x: rect.x + position.x, y: rect.y + position.y }
    : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** `steps` pointer moves in a straight line from `from` to `to`, the last one on `to` */
export function moveSteps(
  from: Point,
  to: Point,
  steps = 1,
): PointerSourceAction[] {
  const count = Math.max(1, Math.floor(steps));
  return Array.from({ length: count }, (_, index) => ({
    type: "pointerMove",
    x: from.x + ((to.x - from.x) * (index + 1)) / count,
    y: from.y + ((to.y - from.y) * (index + 1)) / count,
  }));
}

/** Sends `actions` to the page's mouse, or to its touch pointer; BiDi remembers the position and the pressed buttons */
export async function performPointer(
  connector: BiDiConnector,
  context: string,
  actions: PointerSourceAction[],
  touch = false,
): Promise<void> {
  await connector.send("input.performActions", {
    context,
    actions: [
      {
        type: "pointer",
        id: touch ? TOUCH_ID : POINTER_ID,
        parameters: { pointerType: touch ? "touch" : "mouse" },
        actions,
      },
    ],
  });
}

const pauseFor = (delay: number): PointerSourceAction[] =>
  delay > 0 ? [{ type: "pause", duration: delay }] : [];

/** Checks a click's `button` and `clickCount` before anything is sent; answers the button's BiDi number */
export function checkClick(
  { button, clickCount = 1 }: PointerClickOptions,
  method: string,
): PointerButton {
  const code = buttonCode(button, method);
  if (!Number.isInteger(clickCount) || clickCount < 1) {
    throw new Error(
      `${method}(): clickCount must be a whole number, 1 or more`,
    );
  }
  return code;
}

/** Press and release `clickCount` times at `point`, `delay` ms between each press and release */
export function clickSteps(
  point: Point,
  { button, clickCount = 1, delay = 0 }: PointerClickOptions = {},
  method = "click",
): PointerSourceAction[] {
  const code = checkClick({ button, clickCount }, method);
  return [
    { type: "pointerMove", x: point.x, y: point.y },
    ...Array.from({ length: clickCount }, () => [
      { type: "pointerDown", button: code } as const,
      ...pauseFor(delay),
      { type: "pointerUp", button: code } as const,
    ]).flat(),
  ];
}

/** Clicks `point` (viewport pixels) with real pointer input */
export async function pointerClick(
  connector: BiDiConnector,
  context: string,
  point: Point,
  options?: PointerClickOptions,
  method = "click",
): Promise<void> {
  await performPointer(connector, context, clickSteps(point, options, method));
}

/** Clicks the centre of `rect` (viewport pixels) with real pointer input */
export async function clickRect(
  connector: BiDiConnector,
  context: string,
  rect: Rect,
): Promise<void> {
  await pointerClick(connector, context, pointInRect(rect));
}

/** Moves the mouse to `point` (viewport pixels) */
export async function pointerMoveTo(
  connector: BiDiConnector,
  context: string,
  point: Point,
): Promise<void> {
  await performPointer(connector, context, moveSteps(point, point));
}

/** Touches and lifts a finger at `point` (viewport pixels) */
export async function pointerTap(
  connector: BiDiConnector,
  context: string,
  point: Point,
): Promise<void> {
  await performPointer(
    connector,
    context,
    [
      { type: "pointerMove", x: point.x, y: point.y },
      { type: "pointerDown", button: 0 },
      { type: "pointerUp", button: 0 },
    ],
    true,
  );
}

/** Presses on `from`, moves to `to` in `steps` moves and releases there */
export async function pointerDrag(
  connector: BiDiConnector,
  context: string,
  from: Point,
  to: Point,
  steps: number,
): Promise<void> {
  await performPointer(connector, context, [
    { type: "pointerMove", x: from.x, y: from.y },
    { type: "pointerDown", button: 0 },
    ...moveSteps(from, to, steps),
    { type: "pointerUp", button: 0 },
  ]);
}

/** Turns the mouse wheel at `point` by `deltaX` and `deltaY` pixels */
export async function wheelScroll(
  connector: BiDiConnector,
  context: string,
  point: Point,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await connector.send("input.performActions", {
    context,
    actions: [
      {
        type: "wheel",
        id: WHEEL_ID,
        actions: [
          {
            type: "scroll",
            x: Math.round(point.x),
            y: Math.round(point.y),
            deltaX: Math.round(deltaX),
            deltaY: Math.round(deltaY),
            origin: "viewport",
          },
        ],
      },
    ],
  });
}
