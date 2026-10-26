/** Every toolbar action, as a click on its control runs it. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const HANDLERS_JS = String.raw`  // Every action is what a click on its control does; press() runs the same functions
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
    page: () => openTool("page"),
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
      if (!VALUELESS.includes(a.matcher)) message.expected = a.expected;
      if (a.matcher === "toHaveAttribute") message.attribute = a.attribute;
      if (a.matcher === "toHaveCSS") message.cssName = a.cssName;
      if (a.matcher === "toHaveCount") message.countIndex = a.countIndex;
      ui.busy = true;
      a.error = null;
      post(message);
      render();
    },
    "page-matcher": (detail) => {
      const p = ui.panel === "page" && ui.page;
      if (!p || !p.info || !p.info.ok || !PAGE_MATCHERS.some(([matcher]) => matcher === detail.matcher)) return;
      p.matcher = detail.matcher;
      p.expected = detail.matcher === "toHaveTitle" ? p.info.title : p.info.urlPrefill;
      p.error = null;
      render();
    },
    "page-not": () => {
      if (ui.panel !== "page" || !ui.page || !ui.page.info) return;
      ui.page.not = !ui.page.not;
      render();
    },
    "page-add": () => {
      const p = ui.panel === "page" && ui.page;
      if (!p || ui.busy || !p.info || !p.info.ok) return;
      ui.busy = true;
      ui.pending = p.id;
      p.error = null;
      post({ action: "assert-page", id: p.id, matcher: p.matcher, expected: p.expected, not: p.not });
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
  };`;
