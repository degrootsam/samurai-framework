import type { ElementHandle } from "../script/element-handle.js";
import type { LocatorCall, LocatorSpec, SelectChoice } from "../steps/model.js";
import type { Observation } from "./normalise.js";

/** What the files capture script sends */
export type FilesMessage =
  | { type: "picker" }
  | { type: "picker-cancel" }
  | {
      type: "files";
      via: "input" | "drop";
      target: ElementHandle;
      candidates: LocatorCall[];
      files: { id: number; name: string; type: string; size: number }[];
    };

/** What the capture script sends */
export interface PageMessage {
  type: "click" | "input" | "press" | "assert" | "select";
  target: ElementHandle;
  candidates: LocatorCall[];
  /** Of a click or press: the candidates that matched only the target when it happened, checked in the page */
  unique?: LocatorCall[];
  textEntry?: boolean;
  /** Of a click on a checkbox or radio: whether it leaves the control checked */
  checked?: boolean;
  /** Of a `select` message: the option the tester chose */
  option?: SelectChoice;
  /** The key of a `press` message */
  pressed?: string;
  value?: string;
  secret?: boolean;
  secretName?: string;
  text?: string;
}

/** What a page message says, as the normaliser takes it once its element has a locator */
export function observationFor(
  message: PageMessage,
  locator: LocatorSpec,
): Observation {
  const key = message.target.sharedId;
  return message.type === "click"
    ? {
        type: "click",
        key,
        locator,
        textEntry: message.textEntry === true,
        ...(message.checked !== undefined && { checked: message.checked }),
      }
    : message.type === "select"
      ? { type: "select", key, locator, option: message.option ?? "" }
      : message.type === "press"
        ? { type: "press", key, locator, pressed: message.pressed ?? "" }
        : message.type === "assert"
          ? {
              type: "assert",
              key,
              locator,
              text: message.text ?? "",
              ...(message.value !== undefined && { value: message.value }),
            }
          : {
              type: "input",
              key,
              locator,
              ...(message.value !== undefined && { value: message.value }),
              ...(message.secret && { secret: true }),
              ...(message.secretName !== undefined && {
                secretName: message.secretName,
              }),
            };
}
