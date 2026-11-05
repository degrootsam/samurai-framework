import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { chordSteps, performKeys, textSteps } from "../locator/key-actions.js";
import { parseKeyChord } from "../locator/key-map.js";

/** Types into whatever has focus, replacing the selection: an input, a textarea or an editable element, also in a same-origin frame */
const INSERT_TEXT = `(text) => {
  let doc = document;
  let el = doc.activeElement;
  while (el && el.tagName === "IFRAME" && el.contentDocument && el.contentDocument.activeElement) {
    doc = el.contentDocument;
    el = doc.activeElement;
  }
  const selection = doc.getSelection();
  // A freshly focused editable element can have no caret yet (Firefox): put it at the end
  if (el && el.isContentEditable && selection && !el.contains(selection.anchorNode)) {
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  doc.execCommand("insertText", false, text);
}`;

/** The key `down` and `up` take: one key, no chord, since a chord is several keys */
function singleKey(key: string, method: string): string {
  const chord = parseKeyChord(key, method);
  if (chord.modifiers.length > 0) {
    throw new Error(
      `${method}(): "${key}" is a chord. Press its keys one at a time`,
    );
  }
  return chord.key;
}

/**
 * The page's keyboard: real key input to whatever has focus. BiDi remembers which keys are down between calls,
 * so `down("Shift")`, other input, then `up("Shift")` works, and a held `Shift` capitalizes `press("a")`.
 */
export default class Keyboard {
  constructor(
    private connector: BiDiConnector,
    private contextId: string,
    private assertOpen: () => void,
  ) {}

  /**
   * Presses and releases a key, or a chord: modifiers (`Control`, `Shift`, `Alt`, `Meta`, `ControlOrMeta`) joined to
   * the key by `+`. Named keys are `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Space`, `Insert`, the arrows, `Home`, `End`,
   * `PageUp`, `PageDown` and `F1` to `F12`; any other key is a single character. `delay` waits (ms) between press and release.
   * @example
   *  await page.keyboard.press("Control+a");
   *  await page.keyboard.press("Shift+Tab");
   */
  public async press(key: string, options?: { delay?: number }): Promise<void> {
    this.assertOpen();
    const chord = parseKeyChord(key, "keyboard.press");
    await performKeys(
      this.connector,
      this.contextId,
      chordSteps(chord, options?.delay),
    );
  }

  /** Presses a key and keeps it down until `up`; a modifier stays in effect for the keys and clicks in between */
  public async down(key: string): Promise<void> {
    this.assertOpen();
    await performKeys(this.connector, this.contextId, [
      { type: "keyDown", value: singleKey(key, "keyboard.down") },
    ]);
  }

  /** Releases a key pressed with `down`; a key that is not down is ignored */
  public async up(key: string): Promise<void> {
    this.assertOpen();
    await performKeys(this.connector, this.contextId, [
      { type: "keyUp", value: singleKey(key, "keyboard.up") },
    ]);
  }

  /** Presses and releases one key per character of `text`, `delay` ms apart; a line break is Enter */
  public async type(text: string, options?: { delay?: number }): Promise<void> {
    this.assertOpen();
    await performKeys(
      this.connector,
      this.contextId,
      textSteps(text, options?.delay),
    );
  }

  /**
   * Inserts `text` at the caret of the focused element in one step, as a paste does: `input` fires, `keydown` and `keyup`
   * do not. Does nothing when no editable element has focus.
   */
  public async insertText(text: string): Promise<void> {
    this.assertOpen();
    await callFunction(this.connector, this.contextId, INSERT_TEXT, [text], {
      awaitPromise: false,
    });
  }
}
