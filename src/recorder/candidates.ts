/**
 * Declarations that turn an element into locator candidates (test id, role and name, label, text, css and
 * an absolute xpath), `uniqueOf(el, candidates)`, the candidates that match only that element right now, and
 * `inToolbar(event)`, which is true for events from the recorder toolbar. A string
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

// Not searched by text, as the framework's text locator skips them
const UNTEXTED = ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK"];

// The elements a candidate matches in this document, found the way the framework's locators find them
const matchesOf = (call) => {
  const all = () => Array.prototype.slice.call(document.querySelectorAll("*"));
  switch (call.method) {
    case "getByTestId":
      return all().filter((node) => node.getAttribute("data-testid") === call.testId);
    case "getByRole":
      return all().filter((node) => roleOf(node) === call.role && nameOf(node, call.role) === call.name);
    case "getByLabel":
      return all().filter((node) => labelTexts(node).indexOf(call.text) >= 0);
    case "getByText": {
      const matches = all().filter((node) => UNTEXTED.indexOf(node.tagName) < 0 && textOf(node) === call.text);
      // Only the innermost count: a wrapper around the matching element is not a match
      return matches.filter((node) => !matches.some((other) => other !== node && node.contains(other)));
    }
    case "getByCss":
      try {
        return Array.prototype.slice.call(document.querySelectorAll(call.css));
      } catch (error) {
        return [];
      }
    case "locator": {
      const found = document.evaluate(call.xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const nodes = [];
      for (let i = 0; i < found.snapshotLength; i++) nodes.push(found.snapshotItem(i));
      return nodes;
    }
    default:
      return [];
  }
};

// The candidates that match only el right now: what the recorder falls back to once the page has removed el
const uniqueOf = (el, candidates) =>
  candidates.filter((call) => {
    const found = matchesOf(call);
    return found.length === 1 && found[0] === el;
  });

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
