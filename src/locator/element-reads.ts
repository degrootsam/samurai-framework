import { describeType } from "./element-state.js";

/** Body run in the page as `(el) => { ... }`: a checked checkbox or radio input, or `aria-checked="true"` */
export const IS_CHECKED_BODY = `
  const type = (el.getAttribute("type") || "").toLowerCase();
  const input = el.tagName === "INPUT" && (type === "checkbox" || type === "radio");
  return (input && el.checked) || el.getAttribute("aria-checked") === "true";`;

/** The CSS property name for `getPropertyValue`: camelCase becomes kebab-case (`backgroundColor` to `background-color`), `--custom` and kebab-case names are kept */
export function cssPropertyName(name: string): string {
  if (name.startsWith("--")) return name;
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === null) return null;
  throw new Error(
    `Expected a boolean or null but received "${describeType(value)}"`,
  );
}

export function stringOrNull(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null) return null;
  throw new Error(
    `Expected a string or null but received "${describeType(value)}"`,
  );
}
