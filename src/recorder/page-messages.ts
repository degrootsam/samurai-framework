import type { ElementHandle } from "../script/element-handle.js";
import type { LocatorCall, LocatorSpec } from "../steps/model.js";
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
  type: "click" | "input" | "press" | "assert";
  target: ElementHandle;
  candidates: LocatorCall[];
  /** Of a click or press: the candidates that matched only the target when it happened, checked in the page */
  unique?: LocatorCall[];
  textEntry?: boolean;
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
    ? { type: "click", key, locator, textEntry: message.textEntry === true }
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
