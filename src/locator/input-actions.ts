import type { BiDiConnector } from "../transport/bidi-connection.js";
import type {
  KeyDownAction,
  KeyUpAction,
} from "../types/bidi-modules/input.js";

/** How long `wait()` pauses when no duration is given (ms) */
export const DEFAULT_PAUSE_MS = 300;

// Input source ids: BiDi keeps the pointer position and pressed keys per id, so each kind of input reuses one
// (a touch pointer is a source of its own, with its own id)
export const POINTER_ID = "samurai-pointer";
export const KEYBOARD_ID = "samurai-keyboard";
const PAUSE_ID = "samurai-sleep";

/** Pauses the input queue for `duration` ms */
export async function pause(
  connector: BiDiConnector,
  context: string,
  duration: number,
): Promise<void> {
  await connector.send("input.performActions", {
    context,
    actions: [
      { type: "none", id: PAUSE_ID, actions: [{ type: "pause", duration }] },
    ],
  });
}

/** Types `text` one character at a time (each pressed and released) */
export async function typeText(
  connector: BiDiConnector,
  context: string,
  text: string,
): Promise<void> {
  const actions: Array<KeyDownAction | KeyUpAction> = Array.from(text).flatMap(
    (char) => [
      { type: "keyDown", value: char },
      { type: "keyUp", value: char },
    ],
  );
  await connector.send("input.performActions", {
    context,
    actions: [{ type: "key", id: KEYBOARD_ID, actions }],
  });
}
