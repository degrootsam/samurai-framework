/** WebDriver code points of the named keys; any other single character is typed as is */
export const NAMED_KEYS: Readonly<Record<string, string>> = {
  Backspace: "",
  Tab: "",
  Enter: "",
  Escape: "",
  Space: " ",
  ArrowLeft: "",
  ArrowUp: "",
  ArrowRight: "",
  ArrowDown: "",
  Delete: "",
  Home: "",
  End: "",
  PageUp: "",
  PageDown: "",
  Insert: "",
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `F${i + 1}`,
      String.fromCharCode(0xe031 + i),
    ]),
  ),
};

const MODIFIER_KEYS: Readonly<Record<string, string>> = {
  Control: "",
  Shift: "",
  Alt: "",
  Meta: "",
};

/** The modifier names `click`, `hover` and key chords accept; `ControlOrMeta` is Meta on macOS and Control elsewhere */
export type Modifier = "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift";

/** One key with the modifiers held while it is pressed, as WebDriver code points or characters */
export interface KeyChord {
  modifiers: string[];
  key: string;
}

/** The code points of `modifiers`; `method` names the public method for the error */
export function modifierCodes(
  modifiers: readonly Modifier[],
  platform: string = process.platform,
  method = "click",
): string[] {
  return modifiers.map((name) => {
    if (name === "ControlOrMeta") {
      return platform === "darwin"
        ? MODIFIER_KEYS.Meta!
        : MODIFIER_KEYS.Control!;
    }
    const code = MODIFIER_KEYS[name];
    if (code === undefined) {
      throw new Error(`${method}(): unknown modifier "${name}"`);
    }
    return code;
  });
}

function keyCode(name: string, method: string): string {
  const code =
    NAMED_KEYS[name] ??
    MODIFIER_KEYS[name] ??
    (/^Key[A-Za-z]$/.test(name) ? name.slice(3).toLowerCase() : undefined) ??
    (/^Digit\d$/.test(name) ? name.slice(5) : undefined) ??
    (Array.from(name).length === 1 ? name : undefined);
  if (code === undefined) {
    throw new Error(
      `${method}(): unknown key "${name}". Use a named key such as Enter, Tab or ArrowDown, a single character, or a chord like Control+a`,
    );
  }
  return code;
}

/**
 * Reads a key such as `a`, `Enter` or a chord such as `Control+a`, `Shift+Tab`, `ControlOrMeta+Enter`: modifiers
 * joined by `+`, then one key (which may be `+` itself: `Control++`). `method` names the public method for errors.
 */
export function parseKeyChord(
  spec: string,
  method: string,
  platform: string = process.platform,
): KeyChord {
  if (spec === "+") return { modifiers: [], key: "+" };
  const parts = spec.split("+");
  // "Control++" splits into a trailing empty pair: the last key is the plus sign
  const key = spec.endsWith("++") ? "+" : parts[parts.length - 1]!;
  const names = parts.slice(0, spec.endsWith("++") ? -2 : -1);
  const modifiers = names.map((name) => {
    if (!(name in MODIFIER_KEYS) && name !== "ControlOrMeta") {
      throw new Error(
        `${method}(): "${name}" is not a modifier. A chord is modifiers followed by one key, like Control+a`,
      );
    }
    return name as Modifier;
  });
  return {
    modifiers: modifierCodes(modifiers, platform, method),
    key: keyCode(key, method),
  };
}
