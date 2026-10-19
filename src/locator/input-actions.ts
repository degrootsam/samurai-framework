import type { BiDiConnector } from "../transport/bidi-connection.js";
import type {
  KeyDownAction,
  KeyUpAction,
} from "../types/bidi-modules/input.js";

/** How long `wait()` pauses when no duration is given (ms) */
export const DEFAULT_PAUSE_MS = 300;

// Input source ids: BiDi keeps the pointer position and pressed keys per id, so each kind of input reuses one
const POINTER_ID = "samurai-pointer";
const KEYBOARD_ID = "samurai-keyboard";
const PAUSE_ID = "samurai-sleep";

/** WebDriver code points of the named keys `press()` accepts; any other single character is typed as is */
export const NAMED_KEYS: Readonly<Record<string, string>> = {
  Backspace: "\uE003",
  Tab: "\uE004",
  Enter: "\uE007",
  Escape: "\uE00C",
  Space: " ",
  ArrowLeft: "\uE012",
  ArrowUp: "\uE013",
  ArrowRight: "\uE014",
  ArrowDown: "\uE015",
  Delete: "\uE017",
  Home: "\uE011",
  End: "\uE010",
  PageUp: "\uE00E",
  PageDown: "\uE00F",
};

/** Clicks the centre of `rect` (viewport pixels) with real pointer input */
export async function clickRect(
  connector: BiDiConnector,
  context: string,
  rect: { x: number; y: number; width: number; height: number },
): Promise<void> {
  await connector.send("input.performActions", {
    context,
    actions: [
      {
        type: "pointer",
        id: POINTER_ID,
        actions: [
          {
            type: "pointerMove",
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ],
  });
}

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

/** Presses and releases one key, given as its WebDriver code point or a character */
export async function pressKey(
  connector: BiDiConnector,
  context: string,
  code: string,
): Promise<void> {
  await connector.send("input.performActions", {
    context,
    actions: [
      {
        type: "key",
        id: KEYBOARD_ID,
        actions: [
          { type: "keyDown", value: code },
          { type: "keyUp", value: code },
        ],
      },
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
