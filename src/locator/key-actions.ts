import type { BiDiConnector } from "../transport/bidi-connection.js";
import type {
  KeySourceAction,
  PauseAction,
} from "../types/bidi-modules/input.js";
import { KEYBOARD_ID } from "./input-actions.js";
import { NAMED_KEYS, type KeyChord } from "./key-map.js";

/** Sends `actions` to the page's keyboard; BiDi remembers which keys are down between calls */
export async function performKeys(
  connector: BiDiConnector,
  context: string,
  actions: KeySourceAction[],
): Promise<void> {
  if (actions.length === 0) return;
  await connector.send("input.performActions", {
    context,
    actions: [{ type: "key", id: KEYBOARD_ID, actions }],
  });
}

const pauseFor = (delay: number): PauseAction[] =>
  delay > 0 ? [{ type: "pause", duration: delay }] : [];

/** The modifiers down, the key down and up (`delay` ms apart), the modifiers up again in reverse order */
export function chordSteps(chord: KeyChord, delay = 0): KeySourceAction[] {
  return [
    ...chord.modifiers.map((value) => ({ type: "keyDown", value }) as const),
    { type: "keyDown", value: chord.key },
    ...pauseFor(delay),
    { type: "keyUp", value: chord.key },
    ...[...chord.modifiers]
      .reverse()
      .map((value) => ({ type: "keyUp", value }) as const),
  ];
}

/** One key press per character (a line break is Enter, a tab is Tab), `delay` ms between characters */
export function textSteps(text: string, delay = 0): KeySourceAction[] {
  const chars = Array.from(text);
  return chars.flatMap((char, index) => {
    const value =
      char === "\n" || char === "\r"
        ? NAMED_KEYS.Enter!
        : char === "\t"
          ? NAMED_KEYS.Tab!
          : char;
    return [
      { type: "keyDown", value } as const,
      { type: "keyUp", value } as const,
      ...(index < chars.length - 1 ? pauseFor(delay) : []),
    ];
  });
}

/** Holds `modifiers` down while `action` runs, and lets go of them afterwards even when it throws */
export async function withModifiers<T>(
  connector: BiDiConnector,
  context: string,
  modifiers: readonly string[],
  action: () => Promise<T>,
): Promise<T> {
  if (modifiers.length === 0) return action();
  await performKeys(
    connector,
    context,
    modifiers.map((value) => ({ type: "keyDown", value })),
  );
  try {
    return await action();
  } finally {
    await performKeys(
      connector,
      context,
      [...modifiers].reverse().map((value) => ({ type: "keyUp", value })),
    );
  }
}
