import { CANDIDATES_JS } from "../candidates.js";
import { TOOLBAR_KEY } from "./protocol.js";
import { TOOLBAR_CSS } from "./styles.js";

/**
 * The recorder toolbar: a function declaration `(send) => { … }` installed as a preload script in the
 * `samurai-toolbar` sandbox realm (the caller names the sandbox), top-level documents only. `send` is the
 * toolbar's own channel (not the capture script's); it stays in this closure, which page script cannot
 * reach, and the recorder takes toolbar messages only from this sandbox's realm. It draws a
 * closed shadow root on a `<samurai-recorder-toolbar>` element and is a thin view: it renders the
 * `ToolbarState` the recorder pushes and sends `ToolbarMessage`s; every step is decided by the recorder.
 *
 * `globalThis[Symbol.for("samurai.toolbar")]` in the sandbox holds the hook:
 * - `update(state)`: the recorder's state, after every change and every page load.
 * - `reply(id, result)`: the answer to `pick` (a `PickInfo`) or to `assert`, `insert` and `add-insertable`
 *   (an `ActionReply`).
 * - `root`: the shadow root, for tests.
 * - `press(action, detail?)`: runs the handler a click on that control runs (for tests). Actions:
 *   `pause`, `resume`, `stop`, `collapse`, `expand`, `resume-yes`, `resume-no` (rail);
 *   `assert`, `insert`, `wait`, `screenshot` (open or close the tool);
 *   `pick { target }` (the element a picking click hit);
 *   `matcher { matcher }`, `not`, `assert-add` (Assert panel);
 *   `insert-item { kind, name }`, `insert-first`, `insert-new { kind }` (Insert list);
 *   `new-kind { kind }`, `new-save`, `new-cancel` (New variable or secret);
 *   `wait-add`, `screenshot-add`; `escape` (the Esc key); `dismiss { id }` (a warning's Dismiss button).
 *   Form inputs carry `data-field` (`expected`, `attribute`, `countIndex`, `filter`, `name`, `value`,
 *   `waitKind`, `seconds`, `shotName`, `fullPage`) and update on `input`/`change`.
 * - `rebind(send)`: used by a second run in the same document (a new recording), which keeps the host and
 *   swaps in that recording's toolbar channel.
 * - `state()`, `picking()`: the last state from `update` and whether the Assert picker is on (for tests).
 * - `dispose()`: removes the host and every listener the toolbar put on the window and document (the
 *   recording ended while the document stays open).
 *
 * A string, so no transpiler helper can end up in it.
 */
export const TOOLBAR_SOURCE = String.raw`(send) => {
  if (window !== window.top) return;
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

  // ---- DOM ----
  const h = (tag, props, ...kids) => {
    const node = document.createElement(tag);
    for (const key in props || {}) {
      const value = props[key];
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "value" || key === "checked" || key === "disabled" || key === "selected") node[key] = value;
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false || kid === "") continue;
      node.append(typeof kid === "string" ? document.createTextNode(kid) : kid);
    }
    return node;
  };
  const ico = (text) => h("span", { class: "ico" }, text);

  // Styles go through the CSSOM (property by property, and a constructed sheet), which a page's CSP does not
  // block, unlike a style attribute or a <style> element without 'unsafe-inline'
  const host = document.createElement("samurai-recorder-toolbar");
  const HOST_STYLE = [
    ["all", "initial"], ["display", "block"], ["position", "fixed"], ["top", "0"], ["left", "0"], ["width", "0"],
    ["height", "0"], ["overflow", "visible"], ["z-index", "2147483647"],
  ];
  for (const [name, value] of HOST_STYLE) host.style.setProperty(name, value, "important");
  const root = host.attachShadow({ mode: "closed" });
  const frame = h("div", { class: "frame" });
  const container = h("div", { class: "ui" });
  const outline = h("div", { class: "outline", hidden: true });
  const toast = h("div", { class: "toast ui", hidden: true });
  const notices = h("div", { class: "notices ui" });
  let adopted = false;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    adopted = root.adoptedStyleSheets.length === 1;
  } catch (err) {
    adopted = false;
  }
  // Without constructed sheets: a <style> element, which a strict CSP blocks
  root.append(...(adopted ? [] : [h("style", null, CSS)]), frame, outline, container, toast, notices);

  const viewport = () => ({ w: frame.clientWidth || innerWidth, h: frame.clientHeight || innerHeight });

  // ---- Names and labels ----
  const words = (text) => String(text).replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const camel = (text) => words(text).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("");
  const snake = (text) => words(text).map((w) => w.toUpperCase()).join("_");
  const variableName = (text) => (/^[A-Za-z_$][\w$]*$/.test(text.trim()) ? text.trim() : camel(text));
  const fieldName = (el) => labelTexts(el)[0] || el.getAttribute("name") || el.id || "";
  const fieldLabel = (el) => {
    const text = labelTexts(el)[0] || el.getAttribute("placeholder") || el.getAttribute("name") || el.id || "field";
    return text.length > 40 ? text.slice(0, 39) + "…" : text;
  };

  // ---- Placement ----
  const place = (node, want) => {
    const rect = node.getBoundingClientRect();
    const v = viewport();
    const x = clamp(want ? want.x : v.w - rect.width - 12, v.w - rect.width);
    const y = clamp(want ? want.y : 12, v.h - rect.height);
    node.style.left = x + "px";
    node.style.top = y + "px";
    return { x, y, w: rect.width, h: rect.height };
  };
  const wantedSpot = () => (ui.drag ? ui.drag.pos : ui.dropped || state.position);
  const placePanel = (panel) => {
    const rect = panel.getBoundingClientRect();
    const v = viewport();
    let x;
    let y;
    if (ui.panel === "assert" && ui.assert) {
      const t = ui.assert.rect;
      // Beside the element; below it (or above) when it is too wide for either side
      if (t.right + 8 + rect.width <= v.w) [x, y] = [t.right + 8, t.top];
      else if (t.left - 8 - rect.width >= 0) [x, y] = [t.left - 8 - rect.width, t.top];
      else [x, y] = [t.left, t.bottom + 8 + rect.height <= v.h ? t.bottom + 8 : t.top - 8 - rect.height];
    } else {
      x = railBox.x + railBox.w / 2 > v.w / 2 ? railBox.x - 8 - rect.width : railBox.x + railBox.w + 8;
      y = railBox.y;
    }
    panel.style.left = clamp(x, v.w - rect.width) + "px";
    panel.style.top = clamp(y, v.h - rect.height) + "px";
  };
  const placeAll = () => {
    const [rail, panel] = container.children;
    if (rail) railBox = place(rail, wantedSpot());
    if (panel) placePanel(panel);
  };
  const showOutline = (el) => {
    const r = el.getBoundingClientRect();
    outline.style.left = r.left + "px";
    outline.style.top = r.top + "px";
    outline.style.width = r.width + "px";
    outline.style.height = r.height + "px";
    outline.hidden = false;
  };
  const hideOutline = () => { outline.hidden = true; };

  // ---- Views ----
  const toolOn = (tool) =>
    tool === "assert" ? ui.picking || ui.panel === "assert" : tool === "insert" ? ui.panel === "insert" || ui.panel === "new" : ui.panel === tool;

  const chipView = () =>
    h("div", { class: "chip" },
      h("span", { "data-grip": true, title: "Drag to move" }, "⋮⋮"),
      h("span", { class: paused() ? "dot pause" : "dot" }),
      (paused() ? "Paused" : "Rec") + " · " + state.steps + (state.steps === 1 ? " step" : " steps"),
      h("button", { class: "chev", "data-action": "expand", title: "Expand" }, "⌄"));

  const railView = () => {
    const tool = (action, icon, label) =>
      h("button", { class: toolOn(action) ? "b on" : "b", "data-action": action, disabled: paused() }, ico(icon), label);
    return h("div", { class: paused() || state.resumeQuestion ? "rail wide" : "rail" },
      h("div", { class: "top" },
        h("span", { "data-grip": true, title: "Drag to move" }, "⋮⋮⋮"),
        h("button", { class: "chev", "data-action": "collapse", title: "Collapse" }, "⌃")),
      h("div", { class: "st" }, h("span", { class: paused() ? "dot pause" : "dot" }), paused() ? "Paused" : "Recording"),
      paused() && h("div", { class: "note" }, "Nothing you do now is recorded."),
      state.resumeQuestion && [
        h("div", { class: "note" }, "Add a step that opens this page?"),
        h("div", { class: "ask" },
          h("button", { class: "yes", "data-action": "resume-yes" }, "Yes"),
          h("button", { "data-action": "resume-no" }, "No")),
      ],
      h("div", { class: "sep" }),
      paused()
        ? h("button", { class: "b on", "data-action": "resume" }, ico("▶"), "Resume")
        : h("button", { class: "b", "data-action": "pause" }, ico("❚❚"), "Pause"),
      tool("assert", "✓", "Assert"),
      ui.picking && h("div", { class: "note" }, "Click an element · Esc cancels"),
      tool("insert", "{x}", "Insert"),
      tool("wait", "⏱", "Wait"),
      tool("screenshot", "◉", "Screenshot"),
      h("div", { class: "sep" }),
      h("button", { class: "b stop", "data-action": "stop" }, ico("■"), "Stop"));
  };

  const unavailable = (info, matcher) =>
    (matcher === "toHaveValue" && info.value === undefined) ||
    (matcher === "toHaveAttribute" && info.attributes.length === 0) ||
    (matcher === "toHaveCount" && info.counts.length === 0);
  const prefill = (a, matcher) => {
    const info = a.info;
    if (matcher === "toHaveAttribute") {
      const found = info.attributes.find((at) => at.name === a.attribute) || info.attributes[0];
      return found ? found.value : "";
    }
    if (matcher === "toHaveCount") {
      const found = info.counts[a.countIndex];
      return found ? String(found.count) : "";
    }
    if (matcher === info.first.matcher && info.first.expected !== undefined) return info.first.expected;
    if (matcher === "toHaveText" || matcher === "toContainText") return info.text;
    if (matcher === "toHaveValue") return info.value || "";
    return "";
  };
  const assertValue = (a) => {
    const info = a.info;
    const expected = (type) => h("input", { type, class: "in", "data-field": "expected", value: a.expected, "data-enter": "assert-add", autocomplete: "off" });
    if (a.matcher === "toHaveText" || a.matcher === "toContainText" || a.matcher === "toHaveValue") return h("div", { class: "val" }, expected("text"));
    if (a.matcher === "toHaveAttribute") {
      return h("div", { class: "val" },
        h("select", { class: "in", "data-field": "attribute" }, info.attributes.map((at) => {
          const shown = at.name + '="' + at.value + '"';
          return h("option", { value: at.name, selected: at.name === a.attribute }, shown.length > 44 ? shown.slice(0, 43) + "…" : shown);
        })),
        expected("text"));
    }
    if (a.matcher === "toHaveCount") {
      return h("div", { class: "val" },
        h("select", { class: "in", "data-field": "countIndex" }, info.counts.map((c, i) =>
          h("option", { value: String(i), selected: i === a.countIndex }, c.label + " (" + c.count + ")"))),
        expected("number"));
    }
    return null;
  };
  const assertPanel = () => {
    const a = ui.assert;
    const info = a.info;
    const head = h("div", { class: "h" }, "Assert", info && info.ok && h("code", { title: info.label }, info.label));
    if (!info) return [head, h("div", { class: "msg" }, "…")];
    if (!info.ok) return [head, h("div", { class: "err" }, info.error)];
    return [
      head,
      h("div", { class: "opts" }, MATCHERS.map(([matcher, label]) =>
        h("button", { class: a.matcher === matcher ? "o sel" : "o", "data-action": "matcher", "data-matcher": matcher, disabled: unavailable(info, matcher) }, label))),
      assertValue(a),
      a.error && h("div", { class: "err" }, a.error),
      h("div", { class: "row" },
        h("label", { class: "neg" }, h("input", { type: "checkbox", "data-action": "not", checked: a.not }), "Not"),
        h("button", { class: "add", "data-action": "assert-add", disabled: ui.busy }, "Add")),
    ];
  };

  const matches = () => {
    const filter = ui.insert.filter.trim().toLowerCase();
    const hit = (item) => !filter || item.name.toLowerCase().indexOf(filter) >= 0;
    return {
      filter,
      variables: state.canAddVariables ? state.variables.filter(hit) : [],
      secrets: state.secrets.filter(hit),
    };
  };
  const insertPanel = () => {
    const ins = ui.insert;
    if (!ins.field) return [h("div", { class: "h" }, "Insert"), h("div", { class: "msg" }, "Click into a field first")];
    const found = matches();
    const none = found.filter && found.variables.length === 0 && found.secrets.length === 0;
    const item = (kind, name, value) =>
      h("button", { class: "it", "data-action": "insert-item", "data-kind": kind, "data-name": name, disabled: ui.busy }, h("code", null, name), value);
    return [
      h("div", { class: "h stack" }, 'Insert into "' + fieldLabel(ins.field) + '"', h("small", null, "Environment: " + state.environment)),
      h("input", { type: "text", class: "in search", "data-field": "filter", placeholder: "Filter…", value: ins.filter, "data-enter": "insert-first", autocomplete: "off", spellcheck: "false" }),
      state.canAddVariables && [
        h("div", { class: "grp" }, "Variables"),
        found.variables.length
          ? found.variables.map((v) => item("env", v.name, h("span", { class: "v", title: v.value }, v.value)))
          : h("div", { class: "empty" }, found.filter ? "No variable matches." : "No variables yet."),
      ],
      h("div", { class: "grp" }, "Secrets"),
      found.secrets.length
        ? found.secrets.map((s) => item("secret", s.name, s.set ? h("span", { class: "v" }, "••••••") : h("span", { class: "warn" }, "not set")))
        : h("div", { class: "empty" }, found.filter ? "No secret matches." : "No secrets yet."),
      ins.error && h("div", { class: "err" }, ins.error),
      h("button", { class: "act", "data-action": "insert-new", "data-kind": "env" }, "+ Add variable" + (none ? ' "' + variableName(ins.filter) + '"' : "")),
      h("button", { class: "act", "data-action": "insert-new", "data-kind": "secret" }, "+ Add secret" + (none ? ' "' + snake(ins.filter) + '"' : "")),
    ];
  };

  const newHint = (secret, env, name) => {
    if (!secret) return ["Saved to ", h("code", null, "environments." + env + ".variables"), " in samurai.config.ts. Other environments don't get it — add it there before running against them."];
    if (!state.secretsIgnored) return h("span", { class: "warn" }, "Add .env." + env + " to .gitignore before committing.");
    return ["Saved as ", h("code", null, "SAMURAI_SECRET_" + (name.trim() || "<NAME>")), " in ", h("code", null, ".env." + env), " (git-ignored)."];
  };
  const newPanel = () => {
    const f = ui.form;
    const secret = f.kind === "secret";
    const blocked = !secret && !state.canAddVariables;
    const env = state.environment;
    return [
      h("div", { class: "h stack" }, f.setValue ? "Set value" : secret ? "New secret" : "New variable", h("small", null, 'For "' + fieldLabel(ui.insert.field) + '"')),
      h("div", { class: "seg" },
        h("button", { class: secret ? "" : "sel", "data-action": "new-kind", "data-kind": "env" }, "Variable"),
        h("button", { class: secret ? "sel" : "", "data-action": "new-kind", "data-kind": "secret" }, "Secret")),
      blocked
        ? h("div", { class: "msg" }, "This recording has no environment")
        : [
            h("div", { class: "lbl" }, "Name"),
            h("div", { class: "f" }, h("input", { type: "text", class: "in code", "data-field": "name", value: f.name, "data-enter": "new-save", autocomplete: "off", spellcheck: "false" })),
            f.nameError && h("div", { class: "field-error" }, f.nameError),
            h("div", { class: "lbl" }, "Value in " + env),
            h("div", { class: "f" }, h("input", { type: secret ? "password" : "text", class: "in", "data-field": "value", value: f.value, "data-enter": "new-save", autocomplete: secret ? "new-password" : "off" })),
            h("div", { class: "hint" }, newHint(secret, env, f.name)),
            f.error && h("div", { class: "err" }, f.error),
          ],
      h("div", { class: "foot plain" },
        h("button", { class: "cancel", "data-action": "new-cancel" }, "Cancel"),
        !blocked && h("button", { class: "add", "data-action": "new-save", disabled: ui.busy || !f.name.trim() }, "Save and insert")),
    ];
  };

  const secondsValid = () => {
    const seconds = Number(ui.wait.seconds);
    return ui.wait.seconds.trim() !== "" && isFinite(seconds) && seconds >= 0.1 && seconds <= 60;
  };
  const radio = (field, value, checked, ...label) =>
    h("label", { class: "radio" }, h("input", { type: "radio", name: field, "data-field": field, value, checked }), label);
  const waitPanel = () => [
    h("div", { class: "h" }, "Wait"),
    radio("waitKind", "idle", ui.wait.kind === "idle", "Until the page settles"),
    h("div", { class: "sub" }, "No requests for 500 ms"),
    radio("waitKind", "time", ui.wait.kind === "time", "For ",
      h("input", { type: "number", class: "num", "data-field": "seconds", min: "0.1", max: "60", step: "0.1", value: ui.wait.seconds, "data-enter": "wait-add" }),
      " seconds"),
    h("div", { class: "foot" }, h("button", { class: "add", "data-action": "wait-add", disabled: ui.busy || (ui.wait.kind === "time" && !secondsValid()) }, "Add")),
  ];
  const screenshotPanel = () => [
    h("div", { class: "h" }, "Screenshot"),
    h("div", { class: "grp" }, "Name"),
    h("div", { class: "f" }, h("input", { type: "text", class: "in", "data-field": "shotName", value: ui.shot.name, "data-enter": "screenshot-add", autocomplete: "off", spellcheck: "false" })),
    radio("fullPage", "false", !ui.shot.fullPage, "Visible part"),
    radio("fullPage", "true", ui.shot.fullPage, "Whole page"),
    h("div", { class: "foot" }, h("button", { class: "add", "data-action": "screenshot-add", disabled: ui.busy }, "Add")),
  ];
  const PANELS = { assert: assertPanel, insert: insertPanel, new: newPanel, wait: waitPanel, screenshot: screenshotPanel };

  // Notice nodes live as long as their warning: rebuilding them would make screen readers announce each alert again
  const noticeNodes = new Map();
  let savingNode = null;
  let savingText = null;
  const renderNotices = () => {
    const ids = new Set(state.warnings.map((w) => w.id));
    for (const [id, node] of noticeNodes) {
      if (ids.has(id)) continue;
      node.remove();
      noticeNodes.delete(id);
    }
    for (const w of state.warnings) {
      if (noticeNodes.has(w.id)) continue;
      const node = h("div", { class: "notice warning", "data-warning": String(w.id), role: "alert" },
        h("span", null, w.text),
        h("button", { class: "dismiss", "data-action": "dismiss", "data-id": String(w.id) }, "Dismiss"));
      noticeNodes.set(w.id, node);
      // Before the saving line, which stays last
      notices.insertBefore(node, savingNode);
    }
    const saving = state.saving || null;
    if (saving !== savingText) {
      savingText = saving;
      if (savingNode) savingNode.remove();
      savingNode = saving ? h("div", { class: "notice saving" }, "Saving " + saving + "…") : null;
      if (savingNode) notices.append(savingNode);
    }
  };
  const render = () => {
    const active = root.activeElement;
    const kept = active && active.type !== "radio" ? active.getAttribute("data-field") : null;
    let selection = null;
    try { selection = kept ? [active.selectionStart, active.selectionEnd] : null; } catch (err) { selection = null; }
    const panel = ui.panel && !state.collapsed ? h("div", { class: ui.panel === "new" || ui.panel === "insert" ? "panel wide" : "panel" }, PANELS[ui.panel]()) : null;
    container.replaceChildren(state.collapsed ? chipView() : railView(), ...(panel ? [panel] : []));
    renderNotices();
    placeAll();
    const focus = ui.focus || kept;
    ui.focus = null;
    const target = focus && root.querySelector('[data-field="' + focus + '"]');
    if (!target) return;
    target.focus({ preventScroll: true });
    if (focus === kept && selection && selection[0] !== null) {
      try { target.setSelectionRange(selection[0], selection[1]); } catch (err) { /* not a text input */ }
    }
  };

  // ---- Panels and picking ----
  const closePanel = () => {
    ui.panel = null;
    ui.assert = null;
    ui.busy = false;
    ui.closeOnUpdate = false;
    ui.pending = 0;
    hideOutline();
  };
  const stopPicking = () => {
    ui.picking = false;
    if (ui.panel !== "assert") hideOutline();
  };
  const usable = () => !paused() && !state.collapsed;
  const openTool = (tool) => {
    if (!usable()) return;
    const wasOpen = toolOn(tool);
    stopPicking();
    closePanel();
    if (!wasOpen) {
      ui.panel = tool;
      if (tool === "insert") {
        // The field focused now, else the last one (a toolbar button may have taken the focus)
        const active = document.activeElement;
        const focused = active && active !== host && active.nodeType === 1 && isTextEntry(active) ? active : null;
        const field = focused || (ui.field && ui.field.isConnected ? ui.field : null);
        ui.field = field;
        ui.insert = { field, filter: "", error: null };
        if (field) ui.focus = "filter";
      } else if (tool === "wait") {
        ui.wait = { kind: "idle", seconds: "2" };
      } else if (tool === "screenshot") {
        ui.shot = { name: state.nextScreenshot, fullPage: false };
        ui.focus = "shotName";
      }
    }
    render();
  };
  const pick = (target) => {
    if (!ui.picking || !target || target.nodeType !== 1) return;
    ui.picking = false;
    closePanel();
    const id = nextId++;
    const candidates = candidatesOf(target);
    const r = target.getBoundingClientRect();
    ui.assert = {
      id, target, candidates, info: null, matcher: "toBeVisible", expected: "", attribute: null, countIndex: 0, not: false, error: null,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    };
    ui.panel = "assert";
    ui.pending = id;
    showOutline(target);
    post({ action: "pick", id, target, candidates });
    render();
  };
  const openForm = (kind, name, setValue) => {
    ui.form = { kind, name, value: "", nameError: null, error: null, setValue };
    ui.panel = "new";
    ui.focus = name ? "value" : "name";
    render();
  };
  const sendInsert = (kind, name) => {
    const field = ui.insert.field;
    const id = nextId++;
    ui.pending = id;
    ui.busy = true;
    ui.insert.error = null;
    post({ action: "insert", id, target: field, candidates: candidatesOf(field), kind, name });
    render();
  };

  // Every action is what a click on its control does; press() runs the same functions
  const handlers = {
    dismiss: (d) => post({ action: "dismiss", id: Number(d.id) }),
    pause: () => { if (!paused()) post({ action: "pause" }); },
    resume: () => { if (paused()) post({ action: "resume" }); },
    stop: () => {
      stopPicking();
      closePanel();
      post({ action: "stop" });
      render();
    },
    collapse: () => {
      stopPicking();
      closePanel();
      post({ action: "collapse", collapsed: true });
      render();
    },
    expand: () => post({ action: "collapse", collapsed: false }),
    "resume-yes": () => { if (state.resumeQuestion) post({ action: "resume-goto", add: true }); },
    "resume-no": () => { if (state.resumeQuestion) post({ action: "resume-goto", add: false }); },
    assert: () => {
      if (!usable()) return;
      const wasOn = toolOn("assert");
      stopPicking();
      closePanel();
      ui.picking = !wasOn;
      render();
    },
    insert: () => openTool("insert"),
    wait: () => openTool("wait"),
    screenshot: () => openTool("screenshot"),
    pick: (detail) => pick(detail.target),
    matcher: (detail) => {
      const a = ui.panel === "assert" && ui.assert;
      if (!a || !a.info || !a.info.ok || unavailable(a.info, detail.matcher)) return;
      a.matcher = detail.matcher;
      a.expected = prefill(a, detail.matcher);
      render();
    },
    not: () => {
      if (ui.panel !== "assert" || !ui.assert || !ui.assert.info) return;
      ui.assert.not = !ui.assert.not;
      render();
    },
    "assert-add": () => {
      const a = ui.panel === "assert" && ui.assert;
      if (!a || ui.busy || !a.info || !a.info.ok) return;
      const message = { action: "assert", id: a.id, target: a.target, candidates: a.candidates, matcher: a.matcher, not: a.not };
      if (a.matcher !== "toBeVisible") message.expected = a.expected;
      if (a.matcher === "toHaveAttribute") message.attribute = a.attribute;
      if (a.matcher === "toHaveCount") message.countIndex = a.countIndex;
      ui.busy = true;
      a.error = null;
      post(message);
      render();
    },
    "insert-item": (detail) => {
      if (ui.panel !== "insert" || ui.busy || !ui.insert.field) return;
      if (detail.kind === "secret") {
        const secret = state.secrets.find((s) => s.name === detail.name);
        if (!secret) return;
        if (!secret.set) return openForm("secret", secret.name, true);
      } else if (!state.canAddVariables || !state.variables.some((v) => v.name === detail.name)) {
        return;
      }
      sendInsert(detail.kind, detail.name);
    },
    "insert-first": () => {
      if (ui.panel !== "insert" || !ui.insert.field) return;
      const found = matches();
      const first = found.variables[0] ? { kind: "env", name: found.variables[0].name } : found.secrets[0] && { kind: "secret", name: found.secrets[0].name };
      if (first) handlers["insert-item"](first);
    },
    "insert-new": (detail) => {
      if (ui.panel !== "insert" || !ui.insert.field) return;
      const filter = ui.insert.filter.trim();
      const base = filter || fieldName(ui.insert.field);
      const name = detail.kind === "secret" ? snake(base) : filter ? variableName(filter) : camel(base);
      openForm(detail.kind === "secret" ? "secret" : "env", name, false);
    },
    "new-kind": (detail) => {
      const f = ui.panel === "new" && ui.form;
      if (!f || ui.busy || f.kind === detail.kind) return;
      f.kind = detail.kind === "secret" ? "secret" : "env";
      f.name = f.kind === "secret" ? snake(f.name) : camel(f.name);
      f.nameError = null;
      f.error = null;
      render();
    },
    "new-save": () => {
      const f = ui.panel === "new" && ui.form;
      if (!f || ui.busy || !f.name.trim() || (f.kind === "env" && !state.canAddVariables)) return;
      const field = ui.insert.field;
      const id = nextId++;
      ui.pending = id;
      ui.busy = true;
      f.nameError = null;
      f.error = null;
      post({ action: "add-insertable", id, target: field, candidates: candidatesOf(field), kind: f.kind, name: f.name.trim(), value: f.value });
      render();
    },
    "new-cancel": () => {
      if (ui.panel !== "new") return;
      ui.panel = "insert";
      ui.form = null;
      ui.busy = false;
      ui.pending = 0;
      ui.focus = "filter";
      render();
    },
    "wait-add": () => {
      if (ui.panel !== "wait" || ui.busy) return;
      if (ui.wait.kind === "time" && !secondsValid()) return;
      ui.busy = true;
      ui.closeOnUpdate = true;
      post(ui.wait.kind === "time" ? { action: "wait", kind: "time", ms: Math.round(Number(ui.wait.seconds) * 1000) } : { action: "wait", kind: "idle" });
      render();
    },
    "screenshot-add": () => {
      if (ui.panel !== "screenshot" || ui.busy) return;
      ui.busy = true;
      ui.closeOnUpdate = true;
      post({ action: "screenshot", name: ui.shot.name.trim(), fullPage: ui.shot.fullPage });
      render();
    },
    escape: () => {
      if (!ui.picking && !ui.panel) return false;
      stopPicking();
      closePanel();
      render();
      return true;
    },
  };
  const press = (action, detail) => {
    const handler = handlers[action];
    if (handler) handler(detail || {});
  };

  const onField = (event, target) => {
    const t = target || event.target;
    const field = t && t.getAttribute && t.getAttribute("data-field");
    if (!field) return;
    const value = t.value;
    if (field === "expected" && ui.assert) ui.assert.expected = value;
    else if (field === "attribute" && ui.assert) {
      ui.assert.attribute = value;
      ui.assert.expected = prefill(ui.assert, "toHaveAttribute");
      render();
    } else if (field === "countIndex" && ui.assert) {
      ui.assert.countIndex = Number(value);
      ui.assert.expected = prefill(ui.assert, "toHaveCount");
      render();
    } else if (field === "filter" && ui.insert) {
      if (ui.insert.filter === value) return;
      ui.insert.filter = value;
      render();
    } else if (field === "name" && ui.form) {
      if (ui.form.name === value) return;
      ui.form.name = value;
      ui.form.nameError = null;
      render();
    } else if (field === "value" && ui.form) ui.form.value = value;
    else if (field === "waitKind") {
      ui.wait.kind = value === "time" ? "time" : "idle";
      render();
    } else if (field === "seconds") {
      ui.wait.seconds = value;
      ui.wait.kind = "time";
      render();
    } else if (field === "shotName") ui.shot.name = value;
    else if (field === "fullPage") {
      ui.shot.fullPage = value === "true";
      render();
    }
  };

  // ---- Drag ----
  const onDragMove = (event) => {
    if (!ui.drag) return;
    ui.drag.pos = { x: event.clientX - ui.drag.dx, y: event.clientY - ui.drag.dy };
    ui.drag.moved = true;
    placeAll();
  };
  const endDrag = () => {
    if (!ui.drag) return;
    const { moved, pointer } = ui.drag;
    ui.drag = null;
    window.removeEventListener("pointermove", onDragMove, true);
    window.removeEventListener("pointerup", endDrag, true);
    window.removeEventListener("pointercancel", endDrag, true);
    try { host.releasePointerCapture(pointer); } catch (err) { /* already released */ }
    if (!moved) return;
    ui.dropped = { x: Math.round(railBox.x), y: Math.round(railBox.y) };
    post({ action: "move", x: ui.dropped.x, y: ui.dropped.y });
    placeAll();
  };
  const startDrag = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    ui.drag = { dx: event.clientX - railBox.x, dy: event.clientY - railBox.y, pos: { x: railBox.x, y: railBox.y }, moved: false, pointer: event.pointerId };
    // Captured on the host, which re-renders never replace
    try { host.setPointerCapture(event.pointerId); } catch (err) { /* moves still arrive while over the window */ }
    window.addEventListener("pointermove", onDragMove, true);
    window.addEventListener("pointerup", endDrag, true);
    window.addEventListener("pointercancel", endDrag, true);
  };

  // ---- Events inside the toolbar; none of them reach the page's bubbling listeners ----
  root.addEventListener("click", (event) => {
    event.stopPropagation();
    const control = event.target.closest && event.target.closest("[data-action]");
    if (!control || control.disabled) return;
    press(control.getAttribute("data-action"), {
      kind: control.getAttribute("data-kind"),
      name: control.getAttribute("data-name"),
      matcher: control.getAttribute("data-matcher"),
      id: control.getAttribute("data-id"),
    });
  });
  root.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (event.target.closest && event.target.closest("[data-grip]")) startDrag(event);
  });
  const onKeydown = (event, target) => {
    const enter = event.key === "Enter" && target && target.getAttribute && target.getAttribute("data-enter");
    if (!enter || event.isComposing) return;
    event.preventDefault();
    if (target.getAttribute("data-field")) onField(event, target);
    press(enter);
  };
  // Typing reaches these only when it does not cross the shadow boundary (the window listeners below take the rest)
  root.addEventListener("input", (event) => { event.stopPropagation(); onField(event); });
  root.addEventListener("change", (event) => { event.stopPropagation(); onField(event); });
  root.addEventListener("keydown", (event) => {
    event.stopPropagation();
    onKeydown(event, event.target);
  });
  for (const type of ["keyup", "keypress", "mousedown", "mouseup", "pointerup", "dblclick", "focusin", "focusout"]) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }

  // ---- Events on the page (window capture runs before the page's and the capture script's listeners) ----
  const swallow = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // Typing in the toolbar stays in the toolbar: these run first on the window (registered at document start,
  // before any page script), so no page listener sees a key, typed text or the clipboard of a toolbar input
  // (the New secret value among them). The browser's default action, the text going into the input, still
  // happens. Outside the shadow root the event's target is the host, so the input is the focused element.
  const TYPING = ["keydown", "keyup", "keypress", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend", "paste", "cut", "copy"];
  for (const type of TYPING) {
    listen(window, type, (event) => {
      // An untrusted event was dispatched by the page itself: it neither carries the tester's typing nor acts
      if (!event.isTrusted || !inToolbar(event)) return;
      event.stopImmediatePropagation();
      const target = root.activeElement;
      if (type === "keydown") {
        if (event.key === "Escape" && (ui.picking || ui.panel)) {
          event.preventDefault();
          handlers.escape();
        } else onKeydown(event, target);
      } else if (type === "input" && target && target.type !== "radio" && target.type !== "checkbox") {
        // A radio or checkbox the pointer changed need not have the focus; its change event (below) updates it
        onField(event, target);
      }
    }, true);
  }
  listen(window, "keydown", (event) => {
    if (event.isTrusted && event.key === "Escape" && (ui.picking || ui.panel)) {
      swallow(event);
      handlers.escape();
    }
  }, true);
  listen(window, "pointerover", (event) => {
    if (!ui.picking) return;
    if (inToolbar(event) || !event.target || event.target.nodeType !== 1) hideOutline();
    else showOutline(event.target);
  }, true);
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick", "contextmenu"]) {
    listen(window, type, (event) => {
      if (inToolbar(event)) return;
      if (ui.picking) return swallow(event);
      if (type === "pointerdown" && ui.panel) {
        closePanel();
        render();
      }
    }, true);
  }
  listen(window, "click", (event) => {
    if (!ui.picking || inToolbar(event)) return;
    swallow(event);
    pick(event.target);
  }, true);
  listen(document, "focusin", (event) => {
    if (inToolbar(event) || !event.target || event.target.nodeType !== 1) return;
    ui.field = isTextEntry(event.target) ? event.target : null;
    if (ui.panel === "insert" && !ui.insert.field && ui.field) {
      ui.insert.field = ui.field;
      render();
    }
  }, true);
  listen(window, "resize", () => render());
  listen(window, "scroll", () => {
    if (ui.panel === "assert" && ui.assert && !outline.hidden) showOutline(ui.assert.target);
  }, true);

  // ---- The recorder's side ----
  const showToast = (text) => {
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.remove("gone");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add("gone");
      toastTimer = setTimeout(() => { toast.hidden = true; }, 300);
    }, 2500);
  };
  const update = (next) => {
    state = Object.assign({}, DEFAULTS, next);
    const dropped = ui.dropped;
    if (dropped && state.position && Math.round(state.position.x) === dropped.x && Math.round(state.position.y) === dropped.y) ui.dropped = null;
    if (ui.closeOnUpdate) closePanel();
    if (!usable()) {
      stopPicking();
      closePanel();
    }
    if (state.toast && state.toast.id !== ui.toastId) {
      ui.toastId = state.toast.id;
      showToast(state.toast.text);
    }
    attach();
    render();
  };
  const reply = (id, result) => {
    if (!ui.pending || id !== ui.pending || !result) return;
    ui.busy = false;
    const ok = result.ok === true;
    if (ui.panel === "assert" && ui.assert && !ui.assert.info) {
      const a = ui.assert;
      a.info = result;
      if (ok) {
        a.matcher = result.first.matcher;
        a.attribute = result.attributes[0] ? result.attributes[0].name : null;
        a.countIndex = 0;
        a.expected = prefill(a, a.matcher);
      }
    } else if (ok) {
      closePanel();
    } else if (ui.panel === "assert" && ui.assert) {
      ui.assert.error = result.error;
    } else if (ui.panel === "insert") {
      ui.insert.error = result.error;
    } else if (ui.panel === "new") {
      if (result.field === "name") ui.form.nameError = result.error;
      else ui.form.error = result.error;
    }
    render();
  };

  // ---- Attach ----
  let announced = false;
  const attach = () => {
    const html = document.documentElement;
    if (!html) return false;
    if (host.parentNode !== html) html.appendChild(host);
    if (!announced) {
      announced = true;
      render();
      post({ action: "ready", url: location.href });
    }
    return true;
  };
  const rebind = (fresh) => {
    channel = fresh;
    announced = false;
    attach();
  };
  let watcher = null;
  // The recording ended while this document stays open: take every listener and the host away
  const dispose = () => {
    endDrag();
    for (const [target, type, handler, capture] of listening.splice(0)) target.removeEventListener(type, handler, capture);
    if (watcher) watcher.disconnect();
    clearTimeout(toastTimer);
    channel = () => {};
    host.remove();
    if (globalThis[KEY] && globalThis[KEY].root === root) delete globalThis[KEY];
  };
  globalThis[KEY] = { root, update, reply, press, rebind, dispose, state: () => state, picking: () => ui.picking };

  const focused = document.activeElement;
  if (focused && focused.nodeType === 1 && isTextEntry(focused)) ui.field = focused;
  if (!attach()) {
    watcher = new MutationObserver(() => { if (attach()) watcher.disconnect(); });
    watcher.observe(document, { childList: true });
  }
  // The page may replace the root element while it loads
  listen(document, "DOMContentLoaded", attach);
  listen(window, "load", attach);
}`;
