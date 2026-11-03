import type { ElementRectangle } from "../types/bidi-modules/browsing-context.js";
import { probeState, type ActionabilityContext } from "./actionability.js";
import {
  callOnElement,
  callOnExistingElement,
  type ElementAccess,
} from "./element-access.js";
import { describeType } from "./element-state.js";
import { ACCESSIBLE_NAME_JS } from "./accessible-name.js";

/** Body run in the page as `(el) => { ... }`: a checked checkbox or radio input, or `aria-checked="true"` */
const IS_CHECKED_BODY = `
  const type = (el.getAttribute("type") || "").toLowerCase();
  const input = el.tagName === "INPUT" && (type === "checkbox" || type === "radio");
  return (input && el.checked) || el.getAttribute("aria-checked") === "true";`;

/** The CSS property name for `getPropertyValue`: camelCase becomes kebab-case (`backgroundColor` to `background-color`), `--custom` and kebab-case names are kept */
function cssPropertyName(name: string): string {
  if (name.startsWith("--")) return name;
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === null) return null;
  throw new Error(
    `Expected a boolean or null but received "${describeType(value)}"`,
  );
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null) return null;
  throw new Error(
    `Expected a string or null but received "${describeType(value)}"`,
  );
}

/** Trimmed text content, or null when the element is missing */
export async function readTextContent(
  access: ElementAccess,
): Promise<string | null> {
  return stringOrNull(
    await callOnElement<unknown>(
      access,
      null,
      `return el.textContent.trim();`,
      [],
      [],
      "textContent",
    ),
  );
}

/** The accessible name (see `ACCESSIBLE_NAME_JS`), "" when it has none, or null when the element is missing */
export async function readAccessibleName(
  access: ElementAccess,
): Promise<string | null> {
  return stringOrNull(
    await callOnElement<unknown>(
      access,
      null,
      `${ACCESSIBLE_NAME_JS} return accessibleName(el);`,
      [],
      [],
      "accessibleName",
    ),
  );
}

/** The accessible description, "" when it has none, or null when the element is missing */
export async function readAccessibleDescription(
  access: ElementAccess,
): Promise<string | null> {
  return stringOrNull(
    await callOnElement<unknown>(
      access,
      null,
      `${ACCESSIBLE_NAME_JS} return accessibleDescription(el);`,
      [],
      [],
      "accessibleDescription",
    ),
  );
}

/** Value of an input/textarea/select, or null when missing */
export async function readInputValue(
  access: ElementAccess,
): Promise<string | null> {
  return stringOrNull(
    await callOnElement<unknown>(
      access,
      null,
      `return typeof el.value === "string" ? el.value : null;`,
      [],
      [],
      "inputValue",
    ),
  );
}

/** Attribute value, or null when the element or attribute is missing */
export async function readAttribute(
  access: ElementAccess,
  name: string,
): Promise<string | null> {
  return stringOrNull(
    await callOnElement<unknown>(
      access,
      null,
      `return el.getAttribute(name);`,
      ["name"],
      [name],
      "getAttribute",
    ),
  );
}

/** Whether a checkbox or radio input is checked or the element has `aria-checked="true"`; null when the element is missing */
export async function readIsChecked(
  access: ElementAccess,
): Promise<boolean | null> {
  return booleanOrNull(
    await callOnElement<unknown>(
      access,
      null,
      IS_CHECKED_BODY,
      [],
      [],
      "isChecked",
    ),
  );
}

/** The class attribute as written ("" when the element has none), or null when the element is missing */
export async function readClassAttribute(
  access: ElementAccess,
): Promise<string | null> {
  return stringOrNull(
    await callOnElement<unknown>(
      access,
      null,
      `return el.getAttribute("class") ?? "";`,
      [],
      [],
      "classAttribute",
    ),
  );
}

/** Computed value of a CSS property (camelCase names become kebab-case, `--custom` is kept), or null when the element is missing */
export async function readCssValue(
  access: ElementAccess,
  name: string,
): Promise<string | null> {
  return stringOrNull(
    await callOnElement<unknown>(
      access,
      null,
      `return getComputedStyle(el).getPropertyValue(name);`,
      ["name"],
      [cssPropertyName(name)],
      "cssValue",
    ),
  );
}

/** The browser's getBoundingClientRect result for the element */
export async function readBoundingClientRect(
  access: ElementAccess,
): Promise<ElementRectangle> {
  const rect = await callOnExistingElement<unknown>(
    access,
    `
      const { x, y, width, height, top, right, bottom, left } = el.getBoundingClientRect();
      return { x, y, width, height, top, right, bottom, left };
    `,
    "getBoundingClientRect",
  );
  if (typeof rect !== "object" || rect === null) {
    throw new Error(
      `Expected to receive an object but instead received "${describeType(rect)}"`,
    );
  }
  return rect as ElementRectangle;
}

/** Whether the element exists, has a non-empty box and is not hidden by CSS */
export async function readIsVisible(
  ctx: ActionabilityContext,
): Promise<boolean> {
  const state = await probeState(
    ctx,
    { scroll: false, hitTest: false },
    "isVisible",
  );
  return state.attached && state.visible;
}

/** Whether the element exists and is not disabled; does not wait */
export async function readIsEnabled(
  ctx: ActionabilityContext,
): Promise<boolean> {
  const state = await probeState(
    ctx,
    { scroll: false, hitTest: false },
    "isEnabled",
  );
  return state.attached && state.enabled;
}

/** Like `readIsEnabled`, but null when the element is missing, so callers can tell "disabled" from "not there"; does not wait */
export async function readEnabledState(
  ctx: ActionabilityContext,
): Promise<boolean | null> {
  const state = await probeState(
    ctx,
    { scroll: false, hitTest: false },
    "enabledState",
  );
  return state.attached ? state.enabled : null;
}

/** Whether the element exists and accepts typing (enabled, not readonly, a text field); does not wait */
export async function readIsEditable(
  ctx: ActionabilityContext,
): Promise<boolean> {
  const state = await probeState(
    ctx,
    { scroll: false, hitTest: false },
    "isEditable",
  );
  return state.attached && state.editable;
}
