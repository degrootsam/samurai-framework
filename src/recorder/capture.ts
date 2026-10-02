/** Name of the window flag that tells the capture script to stop reporting (see `CAPTURE_OFF`) */
const OFF_KEY = "samurai.recorder.off";

/**
 * Function declaration installed as a preload script, called as `(send)` where `send` is the recorder's
 * channel. Reports what the tester does in the top-level document:
 *
 * - `{ type: "click", target, candidates, textEntry }`: a click, retargeted to the nearest interactive
 *   element (a label click reports its control; the click the browser forwards to the control is dropped).
 * - `{ type: "input", target, candidates, value, secret, secretName }`: text typed into a field. Password
 *   values never leave the page: `secret` is set and `value` is left out.
 * - `{ type: "press", target, candidates, pressed }`: Enter, Tab or Escape (Enter in a button, link or textarea is a
 *   click or typing, which are reported as such).
 * - `{ type: "assert", target, candidates, text, value }`: an Alt+click, which does not reach the page.
 *   While Alt is held, the element under the pointer is outlined.
 *
 * `candidates` are locator calls for the element, most stable first (test id, role and name, label,
 * text, css, and an absolute xpath that always exists). The recorder checks each one against the page.
 * Runs in the page's own realm; a string, so no transpiler helper can end up in it.
 */
export const CAPTURE_SOURCE = String.raw`(send) => {
  const OFF = Symbol.for("${OFF_KEY}");
  const ON = Symbol.for("samurai.recorder.on");
  const SEND = Symbol.for("samurai.recorder.send");
  if (window !== window.top) return;
  // A document that was recorded before gets the new channel; its listeners are already in place
  window[OFF] = false;
  window[SEND] = send;
  if (window[ON]) return;
  window[ON] = true;
  const report = (message) => window[SEND](message);

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

  const off = () => window[OFF] === true;
  let lastClick = { el: null, at: 0 };
  let outlined = null;
  let outlinedStyle = "";
  const unhighlight = () => {
    if (outlined) outlined.style.outline = outlinedStyle;
    outlined = null;
  };

  document.addEventListener("click", (event) => {
    if (off() || !event.isTrusted || !(event.target instanceof Element)) return;
    if (event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      unhighlight();
      const el = event.target;
      const hasValue = typeof el.value === "string" && el.tagName !== "BUTTON" && el.tagName !== "LI";
      const secret = el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "password";
      report({
        type: "assert",
        target: el,
        candidates: candidatesOf(el),
        text: norm(el.textContent),
        ...(hasValue && !secret && { value: el.value }),
      });
      return;
    }
    const el = interactiveAt(event.target);
    const now = Date.now();
    // The browser forwards a label click to its control as a second click
    if (lastClick.el === el && now - lastClick.at < 150) return;
    lastClick = { el, at: now };
    report({ type: "click", target: el, candidates: candidatesOf(el), textEntry: isTextEntry(el) });
  }, true);

  document.addEventListener("input", (event) => {
    const el = event.target;
    if (off() || !event.isTrusted || !(el instanceof Element) || !isTextEntry(el) || el.isContentEditable) return;
    const secret = el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "password";
    report({
      type: "input",
      target: el,
      candidates: candidatesOf(el),
      ...(secret
        ? { secret: true, secretName: el.getAttribute("name") || el.id || "" }
        : { value: el.value }),
    });
  }, true);

  // Enter, Tab and Escape change what the page does next (an Enter adds a todo and clears the field), so they are steps
  const RECORDED_KEYS = ["Enter", "Tab", "Escape"];
  // Enter on these is a click, which is recorded as one
  const ACTIVATES = "a[href],button,summary,select,input[type=button],input[type=submit],input[type=reset],input[type=checkbox],input[type=radio]";
  document.addEventListener("keydown", (event) => {
    if (off() || !event.isTrusted || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (RECORDED_KEYS.indexOf(event.key) < 0 || !(event.target instanceof Element)) return;
    const el = event.target;
    if (event.key === "Enter" && (el.closest(ACTIVATES) || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    report({ type: "press", target: el, candidates: candidatesOf(el), pressed: event.key });
  }, true);

  document.addEventListener("mousemove", (event) => {
    if (off() || !event.altKey || !(event.target instanceof Element) || event.target === outlined) return;
    unhighlight();
    outlined = event.target;
    outlinedStyle = outlined.style.outline;
    outlined.style.outline = "2px solid #e5484d";
  }, true);
  document.addEventListener("keyup", (event) => { if (event.key === "Alt") unhighlight(); }, true);
  window.addEventListener("blur", unhighlight);
}`;

/** Run in every loaded document to stop its capture script reporting and swallowing Alt+clicks */
export const CAPTURE_OFF = `() => { window[Symbol.for("${OFF_KEY}")] = true; }`;
