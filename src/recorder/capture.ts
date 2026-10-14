import { CANDIDATES_JS } from "./candidates.js";

/** Name of the window flag that tells the capture script to stop reporting (see `CAPTURE_OFF`) */
const OFF_KEY = "samurai.recorder.off";
/** Name of the window flag that pauses the capture script (see `CAPTURE_MUTE`) */
const MUTED_KEY = "samurai.recorder.muted";

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

  ${CANDIDATES_JS}

  const MUTED = Symbol.for("${MUTED_KEY}");
  const off = () => window[OFF] === true || window[MUTED] === true;
  let lastClick = { el: null, at: 0 };
  let outlined = null;
  let outlinedStyle = "";
  const unhighlight = () => {
    if (outlined) outlined.style.outline = outlinedStyle;
    outlined = null;
  };

  document.addEventListener("click", (event) => {
    if (inToolbar(event)) return;
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
    if (inToolbar(event)) return;
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
    if (inToolbar(event)) return;
    if (off() || !event.isTrusted || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (RECORDED_KEYS.indexOf(event.key) < 0 || !(event.target instanceof Element)) return;
    const el = event.target;
    if (event.key === "Enter" && (el.closest(ACTIVATES) || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    report({ type: "press", target: el, candidates: candidatesOf(el), pressed: event.key });
  }, true);

  document.addEventListener("mousemove", (event) => {
    // Alt+click on the toolbar asserts nothing, so nothing there (or behind it) is outlined
    if (inToolbar(event)) return unhighlight();
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

/** Run in every loaded document to pause its capture script (the toolbar's Pause, and while it types a value) */
export const CAPTURE_MUTE = `() => { window[Symbol.for("${MUTED_KEY}")] = true; }`;

/** Run in every loaded document to resume what `CAPTURE_MUTE` paused */
export const CAPTURE_UNMUTE = `() => { window[Symbol.for("${MUTED_KEY}")] = false; }`;
