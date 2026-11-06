import { ACCESSIBLE_NAME_JS } from "../locator/accessible-name.js";
import { CANDIDATES_JS } from "../recorder/candidates.js";

/** Name of the page-global that holds the references of the latest snapshot */
const STORE_KEY = "samurai.agent.refs";

/**
 * Page-side: `isSecret(el, selectors)` is true for a field whose value must never leave the page: a password
 * input, a one-time code or card field (by `autocomplete`), or an element matching one of the caller's selectors.
 */
const SECRET_JS = String.raw`
  const isSecret = (el, selectors) => {
    if (el.localName === "input" && (el.getAttribute("type") || "").toLowerCase() === "password") return true;
    if (/password|one-time-code|cc-/i.test(el.getAttribute("autocomplete") || "")) return true;
    for (const selector of selectors) {
      try { if (el.matches(selector)) return true; } catch (error) { /* a bad selector hides nothing */ }
    }
    return false;
  };`;

/**
 * Function declaration, called as `(options)` with `{ maxChars, secretFields }`. Writes the page as text (see
 * `Snapshotter.take`) and remembers the elements it numbered, so `RESOLVE_SCRIPT` can find them again. Secret
 * values are replaced here, in the page: they never reach the framework.
 */
export const SNAPSHOT_SCRIPT = String.raw`(options) => {
  ${ACCESSIBLE_NAME_JS}
  ${SECRET_JS}
  const KEY = Symbol.for("${STORE_KEY}");
  const store = window[KEY] || (window[KEY] = { next: 1, ids: new WeakMap(), map: new Map() });
  store.map = new Map();
  const SHOWN = new Set(["button", "link", "textbox", "searchbox", "combobox", "listbox", "checkbox", "radio", "switch",
    "slider", "spinbutton", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem",
    "heading", "img", "navigation", "main", "banner", "contentinfo", "region", "form", "dialog", "alertdialog", "alert",
    "status", "table", "list", "listitem", "row", "cell", "columnheader", "rowheader", "gridcell", "article", "tablist",
    "menu", "toolbar", "progressbar"]);
  // Their text is their name: nothing inside is listed again
  const LEAF = new Set(["button", "link", "heading", "checkbox", "radio", "option", "switch", "tab", "menuitem",
    "menuitemcheckbox", "menuitemradio", "treeitem"]);
  const SKIPPED = new Set(["script", "style", "noscript", "template", "head", "svg"]);
  const cut = (text, max) => (text.length > max ? text.slice(0, max - 1) + "…" : text);
  const quote = (text) => '"' + text.replace(/"/g, '\\"') + '"';
  const lines = [];
  let size = 0;
  let omitted = 0;
  const add = (line) => {
    if (size + line.length + 1 > options.maxChars) { omitted++; return false; }
    lines.push(line);
    size += line.length + 1;
    return true;
  };
  const refOf = (el) => {
    let id = store.ids.get(el);
    if (id === undefined) { id = store.next++; store.ids.set(el, id); }
    return id;
  };
  const checkedOf = (el, role) => {
    if (!["checkbox", "radio", "switch", "menuitemcheckbox"].includes(role)) return "";
    const aria = el.getAttribute("aria-checked");
    if (aria === "mixed" || el.indeterminate) return " mixed";
    return (el.checked === true || aria === "true") ? " checked" : " unchecked";
  };
  const valueOf = (el, role) => {
    if (!["textbox", "searchbox", "spinbutton", "combobox", "slider", "listbox"].includes(role)) return "";
    let value = "";
    if (el.localName === "select") value = Array.from(el.selectedOptions).map((o) => o.label || o.textContent).join(", ");
    else if (typeof el.value === "string") value = el.value;
    if (value === "") return "";
    return " value=" + quote(isSecret(el, options.secretFields) ? "••••" : cut(squash(value), 80));
  };
  const statesOf = (el, role) => {
    let out = checkedOf(el, role);
    if (el.disabled === true || el.getAttribute("aria-disabled") === "true") out += " disabled";
    if (el.getAttribute("aria-expanded") === "true") out += " expanded";
    if (el.getAttribute("aria-expanded") === "false") out += " collapsed";
    if (el.selected === true || el.getAttribute("aria-selected") === "true") out += " selected";
    if (el.getAttribute("aria-pressed") === "true") out += " pressed";
    if (el.required === true || el.getAttribute("aria-required") === "true") out += " required";
    if (el.readOnly === true) out += " readonly";
    if (el === document.activeElement) out += " focused";
    if (role === "heading") out += " level=" + (Number(el.getAttribute("aria-level")) || Number(el.localName.slice(1)) || 1);
    return out;
  };
  const ownText = (el) => squash(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(" "));
  const visit = (el, depth) => {
    if (el.nodeType !== 1 || SKIPPED.has(el.localName)) return;
    if (el.getAttribute("aria-hidden") === "true" || el.hidden) return;
    const style = getComputedStyle(el);
    if (style.display === "none") return;
    const visible = style.visibility !== "hidden" && style.visibility !== "collapse";
    const role = roleOf(el);
    const clickable = el.hasAttribute("onclick") || (el.hasAttribute("tabindex") && Number(el.getAttribute("tabindex")) >= 0);
    let indent = depth;
    if (visible) {
      let line = "";
      if (SHOWN.has(role)) {
        const name = cut(accessibleName(el) || ownText(el), 100);
        line = role + (name ? " " + quote(name) : "") + valueOf(el, role) + statesOf(el, role);
      } else if (clickable) {
        line = "clickable " + quote(cut(accessibleName(el) || squash(el.textContent || ""), 100)) + statesOf(el, role);
      } else if (!["input", "select", "textarea"].includes(el.localName)) {
        const text = ownText(el);
        if (text) line = "text " + quote(cut(text, 160));
      }
      if (line) {
        const id = refOf(el);
        if (add("  ".repeat(depth) + "[e" + id + "] " + line)) store.map.set(id, el);
        indent = depth + 1;
      }
    }
    if (LEAF.has(role)) return;
    for (const child of el.children) visit(child, indent);
  };
  if (document.body) visit(document.body, 0);
  const text = lines.join("\n");
  return { text, omitted, count: store.map.size, url: location.href, title: document.title };
}`;

/**
 * Function declaration, called as `({ ref, focused, secretFields })` with the number of a reference, or `focused`
 * for the element that has focus. Answers `{ status: "ok", target, candidates, secret, dotted, role, name }`, or a status
 * that says why the reference does not resolve: `none` (no snapshot in this document), `unknown`, `older` (it was
 * in an earlier snapshot), `gone` (removed since), `nofocus`.
 */
export const RESOLVE_SCRIPT = String.raw`(options) => {
  const KEY = Symbol.for("${STORE_KEY}");
  const store = window[KEY];
  const accessible = (() => { ${ACCESSIBLE_NAME_JS}; return { accessibleName, roleOf }; })();
  const candidates = (() => { ${CANDIDATES_JS}; return { candidatesOf }; })();
  ${SECRET_JS}
  let el;
  if (options.focused) {
    el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { status: "nofocus" };
  } else {
    if (!store) return { status: "none" };
    el = store.map.get(options.ref);
    if (!el) return { status: options.ref >= store.next ? "unknown" : "older" };
    if (!el.isConnected) return { status: "gone" };
  }
  return {
    status: "ok",
    target: el,
    candidates: candidates.candidatesOf(el),
    secret: isSecret(el, options.secretFields),
    dotted: el.localName === "input" && (el.getAttribute("type") || "").toLowerCase() === "password",
    role: accessible.roleOf(el),
    name: accessible.accessibleName(el),
  };
}`;
