/** The recorder's side of the hook: update, reply, rebind, dispose. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const RECORDER_SIDE_JS = String.raw`  // ---- The recorder's side ----
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
        a.cssName = result.css.name;
        a.cssValue = result.css.value;
        a.expected = prefill(a, a.matcher);
      }
    } else if (ui.panel === "output" && ui.output && !ui.output.info) {
      ui.output.info = result;
      if (ok) ui.focus = "outputName";
    } else if (ui.panel === "page" && ui.page && !ui.page.info) {
      ui.page.info = result;
      if (ok) {
        ui.page.expected = result.urlPrefill;
        ui.focus = "pageExpected";
      }
    } else if (ok) {
      closePanel();
    } else if (ui.panel === "assert" && ui.assert) {
      ui.assert.error = result.error;
    } else if (ui.panel === "output" && ui.output) {
      if (result.field === "name") ui.output.nameError = result.error;
      else ui.output.error = result.error;
    } else if (ui.panel === "page" && ui.page) {
      ui.page.error = result.error;
    } else if (ui.panel === "insert") {
      ui.insert.error = result.error;
    } else if (ui.panel === "new") {
      if (result.field === "name") ui.form.nameError = result.error;
      else ui.form.error = result.error;
    }
    render();
  };
`;
