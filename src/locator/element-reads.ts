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
