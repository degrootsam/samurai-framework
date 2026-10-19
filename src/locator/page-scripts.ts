import type { CheckName } from "./element-state.js";

/** Page-side source strings and the actionability checks each action waits for */

/** What `setInputFiles` needs to know about the element before it sends files */
export const FILE_INPUT_INFO = `(el) => ({
  tag: el.tagName.toLowerCase(),
  type: (el.getAttribute("type") || "").toLowerCase(),
  multiple: Boolean(el.multiple),
})`;

export const FILE_INPUT_CHECKS: readonly CheckName[] = ["attached", "enabled"];
export const DROP_CHECKS: readonly CheckName[] = ["attached", "visible"];
/** The sandbox `dropFiles` builds its files in */
export const DROP_SANDBOX = "samurai-drop";
const DROP_KEY = `globalThis[Symbol.for("samurai.drop")]`;
export const DROP_INPUT = `() => {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  ${DROP_KEY} = input;
  return input;
}`;
/** Fires dragenter, dragover and drop at the element's centre with the input's files (retyped where asked) */
export const DROP_EVENTS = `(el, types) => {
  const input = ${DROP_KEY};
  delete ${DROP_KEY};
  const data = new DataTransfer();
  Array.from(input.files).forEach((file, i) => {
    data.items.add(types[i] ? new File([file], file.name, { type: types[i], lastModified: file.lastModified }) : file);
  });
  const box = el.getBoundingClientRect();
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  for (const type of ["dragenter", "dragover", "drop"]) {
    el.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true, dataTransfer: data }, at)));
  }
}`;
export const SCREENSHOT_CHECKS: readonly CheckName[] = ["attached", "visible"];

export const CLICK_CHECKS: readonly CheckName[] = [
  "attached",
  "visible",
  "stable",
  "enabled",
  "hit target",
];
export const FILL_CHECKS: readonly CheckName[] = [
  "attached",
  "visible",
  "enabled",
  "editable",
  "hit target",
];
export const PRESS_CHECKS: readonly CheckName[] = [
  "attached",
  "visible",
  "enabled",
];
export const ATTACHED_ONLY: readonly CheckName[] = ["attached"];
