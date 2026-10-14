/**
 * Declarations that turn an element into locator candidates (test id, role and name, label, text, css and
 * an absolute xpath), plus `inToolbar(event)`, which is true for events from the recorder toolbar. A string
 * of plain declarations, interpolated into the capture script (page realm) and the toolbar script
 * (sandbox realm), so no transpiler helper can end up in it.
 */
export const CANDIDATES_JS = String.raw`
const norm = (text) => String(text == null ? "" : text).replace(/\s+/g, " ").trim();
const textOf = (node) => norm(node.innerText != null ? node.innerText : node.textContent);
const NO_ROLE_TYPES = ["hidden", "password", "file", "color", "date", "datetime-local", "month", "time", "week"];
const TEXT_TYPES = ["", "text", "email", "search", "tel", "url", "password", "number"];

const roleOf = (el) => {
  const explicit = norm(el.getAttribute("role")).split(" ")[0];
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return el.hasAttribute("href") ? "link" : undefined;
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "select") return el.multiple || el.size > 1 ? "listbox" : "combobox";
  if (tag === "textarea") return "textbox";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "img") return "img";
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (NO_ROLE_TYPES.indexOf(type) >= 0) return undefined;
    if (type === "checkbox" || type === "radio") return type;
    if (type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
    if (type === "range") return "slider";
    if (type === "number") return "spinbutton";
    if (type === "search") return "searchbox";
    return "textbox";
  }
  return undefined;
};

const labelTexts = (el) => {
  const texts = [];
  if (el.labels) for (const label of el.labels) texts.push(textOf(label));
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    for (const id of by.split(/\s+/)) {
      const named = id && document.getElementById(id);
      if (named) texts.push(textOf(named));
    }
  }
  const own = el.getAttribute("aria-label");
  if (own) texts.push(norm(own));
  return texts.filter(Boolean);
};

const nameOf = (el, role) => {
  const labelled = labelTexts(el)[0];
  if (labelled) return labelled;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const type = (el.getAttribute("type") || "").toLowerCase();
    return type === "submit" || type === "button" || type === "reset" ? norm(el.value) : "";
  }
  if (tag === "img") return norm(el.getAttribute("alt"));
  if (role === "textbox" || role === "combobox" || role === "listbox") return "";
  return textOf(el) || norm(el.getAttribute("title"));
};

const plain = (value) => value.indexOf('"') < 0 && value.indexOf("\\") < 0;

const xpathOf = (el) => {
  const parts = [];
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    let index = 1;
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.tagName === node.tagName) index++;
    }
    parts.unshift(node.tagName.toLowerCase() + "[" + index + "]");
  }
  return "/" + parts.join("/");
};

const candidatesOf = (el) => {
  const found = [];
  const tag = el.tagName.toLowerCase();
  const testId = el.getAttribute("data-testid");
  if (testId) found.push({ method: "getByTestId", testId });
  const role = roleOf(el);
  if (role) {
    const name = nameOf(el, role);
    if (name && name.length <= 80) found.push({ method: "getByRole", role, name });
  }
  const label = labelTexts(el)[0];
  if (label && label.length <= 80 && el.labels !== undefined) found.push({ method: "getByLabel", text: label });
  const text = textOf(el);
  if (text && text.length <= 60 && tag !== "input" && tag !== "textarea" && tag !== "select") {
    found.push({ method: "getByText", text });
  }
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !/\d{3,}/.test(el.id)) found.push({ method: "getByCss", css: "#" + el.id });
  const name = el.getAttribute("name");
  if (name && plain(name)) found.push({ method: "getByCss", css: tag + '[name="' + name + '"]' });
  const placeholder = el.getAttribute("placeholder");
  if (placeholder && plain(placeholder)) found.push({ method: "getByCss", css: tag + '[placeholder="' + placeholder + '"]' });
  found.push({ method: "locator", xpath: xpathOf(el) });
  return found;
};

const isTextEntry = (el) => {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") return TEXT_TYPES.indexOf((el.getAttribute("type") || "").toLowerCase()) >= 0;
  return Boolean(el.isContentEditable);
};

const INTERACTIVE = "a[href],button,input,select,textarea,label,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch]";
const interactiveAt = (target) => {
  const found = target.closest(INTERACTIVE) || target;
  return found.tagName === "LABEL" && found.control ? found.control : found;
};
const TOOLBAR_TAG = "SAMURAI-RECORDER-TOOLBAR";
const inToolbar = (event) =>
  event.composedPath().some((node) => node && node.tagName === TOOLBAR_TAG);
`;
