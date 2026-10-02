/** WebDriver code points of the named keys `press()` accepts; any other single character is typed as is */
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
};

/** Keys held down while another is pressed: `Control+Enter`, `Shift+Tab` */
export const MODIFIER_KEYS: Readonly<Record<string, string>> = {
  Control: "",
  Shift: "",
  Alt: "",
  Meta: "",
};

export interface ParsedKey {
  /** Code points of the modifiers, in the order they are held down */
  modifiers: string[];
  /** Code point or character of the key that is pressed */
  key: string;
}

/** `Control+Shift+Enter` as its parts; a `+` that is itself the key stays whole (`+`, `Control++`) */
function splitKey(key: string): string[] {
  if (key === "+") return ["+"];
  if (key.endsWith("++")) return [...key.slice(0, -2).split("+"), "+"];
  return key.split("+");
}

/** What to send for `key`: zero or more modifiers and one key. Undefined when `key` is not one `press()` knows */
export function parseKey(key: string): ParsedKey | undefined {
  const parts = splitKey(key);
  const last = parts.pop();
  if (last === undefined || last === "") return undefined;
  const main =
    NAMED_KEYS[last] ?? (Array.from(last).length === 1 ? last : undefined);
  if (main === undefined) return undefined;
  const modifiers: string[] = [];
  for (const part of parts) {
    const code = MODIFIER_KEYS[part];
    if (code === undefined) return undefined;
    modifiers.push(code);
  }
  return { modifiers, key: main };
}

/** The key actions for a parsed key: modifiers down, the key down and up, modifiers up in reverse */
export function keyActions({
  modifiers,
  key,
}: ParsedKey): Array<{ type: "keyDown" | "keyUp"; value: string }> {
  return [
    ...modifiers.map((value) => ({ type: "keyDown" as const, value })),
    { type: "keyDown", value: key },
    { type: "keyUp", value: key },
    ...[...modifiers]
      .reverse()
      .map((value) => ({ type: "keyUp" as const, value })),
  ];
}
