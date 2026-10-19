import { CANDIDATES_JS } from "../../candidates.js";
import { TOOLBAR_KEY } from "../protocol.js";
import { TOOLBAR_CSS } from "../styles.js";

/** Preamble: single-run guard, shared candidate code, styles, defaults and the toolbar state variables. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const SETUP_JS = String.raw`  if (window !== window.top) return;
  const KEY = Symbol.for("${TOOLBAR_KEY}");
  if (globalThis[KEY]) {
    globalThis[KEY].rebind(send);
    return;
  }

  ${CANDIDATES_JS}

  const CSS = ${JSON.stringify(TOOLBAR_CSS)};
  const DEFAULTS = {
    status: "recording", collapsed: false, position: null, steps: 0, environment: "", canAddVariables: false,
    variables: [], secrets: [], secretsIgnored: true, resumeQuestion: false, nextScreenshot: "screenshot-1",
    warnings: [],
  };
  const MATCHERS = [
    ["toBeVisible", "Visible"], ["toHaveText", "Has text"], ["toContainText", "Contains text"],
    ["toHaveValue", "Has value"], ["toHaveAttribute", "Has attribute"], ["toHaveCount", "Count"],
  ];

  let channel = send;
  let state = Object.assign({}, DEFAULTS);
  let nextId = Date.now();
  let railBox = { x: 0, y: 0, w: 0, h: 0 };
  let toastTimer = 0;
  // Local UI state; everything about steps lives in the recorder
  const ui = {
    panel: null, picking: false, busy: false, closeOnUpdate: false, pending: 0, focus: null,
    field: null, assert: null, insert: null, form: null,
    wait: { kind: "idle", seconds: "2" }, shot: { name: "", fullPage: false },
    drag: null, dropped: null, toastId: null,
  };

  const post = (message) => {
    try { channel(Object.assign({ type: "toolbar" }, message)); } catch (err) { /* the channel is gone */ }
  };
  // Listeners on the page's window and document, so dispose() can take them all off again
  const listening = [];
  const listen = (target, type, handler, capture) => {
    target.addEventListener(type, handler, capture === true);
    listening.push([target, type, handler, capture === true]);
  };
  const paused = () => state.status === "paused";
  // Whole pixels, so a rail at the far edge does not overhang it by a rounding error
  const clamp = (value, max) => Math.max(0, Math.min(value, Math.floor(max)));
`;
