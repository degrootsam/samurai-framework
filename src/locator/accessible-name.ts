import { NAME_FROM_CONTENT_ROLES, ROLE_OF_JS } from "./role-table.js";

/**
 * Page-side source that defines, in the scope it is pasted into:
 *
 * - `isHidden(el)`: not rendered or hidden from assistive technology: `display: none`, `visibility: hidden` or
 *   `collapse`, or `aria-hidden="true"` on the element or an ancestor.
 * - `accessibleName(el)` and `accessibleDescription(el)`: strings, whitespace collapsed and trimmed.
 * - `roleOf(el)` (from `ROLE_OF_JS`).
 *
 * The name follows the accname algorithm in a simplified form, the order being: `aria-labelledby` (hidden content is
 * read when referenced directly), `aria-label`, the native text alternative (`alt` of img / area / input[type=image],
 * `value` of button-like inputs, the `<label>`s of a form control, `<legend>`, `<caption>`, `<figcaption>`, svg
 * `<title>`), the content for roles that take their name from it (and always for what an embedding walks through),
 * the `title` attribute, and for a text field its `placeholder`. Embedded form controls count by their value, and
 * `::before` / `::after` text by its CSS content. Hidden descendants are skipped. A reference loop stops at the
 * element already visited. The description is `aria-describedby`, else `aria-description`, else the `title` when it was not
 * used as the name.
 *
 * It deliberately differs from the browser's own accessibility tree: no CSS `display` quirks for table parts, no
 * `<summary>` or `<details>` rules, no shadow DOM or slot flattening, no `aria-owns`, and `placeholder` counts as a name
 * for inputs in both browsers' way (Firefox and Chrome disagree there).
 */
export const ACCESSIBLE_NAME_JS = `
  ${ROLE_OF_JS}
  const NAME_FROM_CONTENT = ${JSON.stringify(NAME_FROM_CONTENT_ROLES)};
  const squash = (text) => String(text).replace(/\\s+/g, " ").trim();
  const hiddenSelf = (n) => {
    if (n.getAttribute("aria-hidden") === "true") return true;
    const style = getComputedStyle(n);
    return style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse";
  };
  const isHidden = (el) => {
    if (hiddenSelf(el)) return true;
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (n.getAttribute("aria-hidden") === "true" || getComputedStyle(n).display === "none") return true;
    }
    return false;
  };
  const byIds = (el, attribute) => (el.getAttribute(attribute) || "").split(/\\s+/)
    .map((id) => (id ? el.ownerDocument.getElementById(id) : null)).filter(Boolean);
  const pseudoText = (el, which) => {
    const content = getComputedStyle(el, which).content;
    return content && content !== "none" && content !== "normal" && /^["']/.test(content) ? content.slice(1, -1) : "";
  };
  const embeddedValue = (el, role) => {
    if (role === "textbox" || role === "searchbox" || role === "spinbutton" || role === "slider") return el.value ?? el.getAttribute("aria-valuenow") ?? "";
    if (role === "combobox" || role === "listbox") {
      const chosen = el.localName === "select" ? Array.from(el.selectedOptions) : [];
      return chosen.map((option) => option.label || option.textContent).join(" ");
    }
    return null;
  };
  /** The text of a node and what it embeds. \`seen\` guards reference loops; \`top\` is the node whose name is asked for */
  const walk = (node, seen, top) => {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 || seen.has(node)) return "";
    if (node !== top && hiddenSelf(node)) return "";
    if (["script", "style", "noscript", "template"].includes(node.localName)) return "";
    seen.add(node);
    const label = node !== top && (node.getAttribute("aria-label") || "").trim();
    if (label) return label;
    const role = roleOf(node);
    if (node !== top) {
      const value = embeddedValue(node, role);
      if (value !== null) return value;
    }
    let text = pseudoText(node, "::before");
    for (const child of node.childNodes) {
      const part = walk(child, seen, top);
      const block = child.nodeType === 1 && getComputedStyle(child).display !== "inline";
      text += block ? " " + part + " " : part;
    }
    return text + pseudoText(node, "::after");
  };
  const fromReferences = (el, attribute, seen) => squash(byIds(el, attribute).map((ref) => {
    const own = (ref.getAttribute("aria-label") || "").trim();
    return own || walk(ref, new Set(seen), ref);
  }).join(" "));
  const labelText = (el, seen) => squash(Array.from(el.labels || []).map((label) => walk(label, new Set(seen), label)).join(" "));
  const nativeName = (el, seen) => {
    const tag = el.localName;
    const type = (el.getAttribute("type") || "").toLowerCase();
    const first = (selector) => el.querySelector(":scope > " + selector);
    if (tag === "img" || tag === "area" || (tag === "input" && type === "image")) {
      const alt = el.getAttribute("alt");
      if (alt !== null && squash(alt)) return squash(alt);
      if (tag === "input") return squash(el.getAttribute("value") || "") || labelText(el, seen);
      return "";
    }
    if (tag === "input" && (type === "button" || type === "submit" || type === "reset")) {
      const value = squash(el.getAttribute("value") || "");
      return value || labelText(el, seen) || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : "");
    }
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "meter" || tag === "progress" || tag === "output") return labelText(el, seen);
    if (tag === "fieldset") { const legend = first("legend"); return legend ? squash(walk(legend, new Set(seen), legend)) : ""; }
    if (tag === "table") { const caption = first("caption"); return caption ? squash(walk(caption, new Set(seen), caption)) : ""; }
    if (tag === "figure") { const caption = first("figcaption"); return caption ? squash(walk(caption, new Set(seen), caption)) : ""; }
    if (tag === "svg") { const title = first("title"); return title ? squash(title.textContent) : ""; }
    return "";
  };
  /** The name and where it came from (\`title\` or \`placeholder\` matter to the description) */
  const nameSource = (el) => {
    const seen = new Set([el]);
    const referenced = fromReferences(el, "aria-labelledby", seen);
    if (referenced) return { name: referenced, source: "labelledby" };
    const own = squash(el.getAttribute("aria-label") || "");
    if (own) return { name: own, source: "label" };
    const native = nativeName(el, seen);
    if (native) return { name: native, source: "native" };
    if (NAME_FROM_CONTENT.includes(roleOf(el)) || el.localName === "label" || el.localName === "legend" || el.localName === "caption") {
      const content = squash(walk(el, new Set(), el));
      if (content) return { name: content, source: "content" };
    }
    const title = squash(el.getAttribute("title") || "");
    if (title) return { name: title, source: "title" };
    const placeholder = squash(el.getAttribute("placeholder") || "");
    if ((el.localName === "input" || el.localName === "textarea") && placeholder) return { name: placeholder, source: "placeholder" };
    return { name: "", source: "" };
  };
  const accessibleName = (el) => nameSource(el).name;
  const accessibleDescription = (el) => {
    const referenced = fromReferences(el, "aria-describedby", new Set([el]));
    if (referenced) return referenced;
    const attribute = squash(el.getAttribute("aria-description") || "");
    if (attribute) return attribute;
    const title = squash(el.getAttribute("title") || "");
    return title && nameSource(el).source !== "title" ? title : "";
  };`;
