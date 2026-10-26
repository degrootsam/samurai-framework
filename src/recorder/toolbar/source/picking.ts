/** Opening and closing panels, and picking an element. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const PICKING_JS = String.raw`  // ---- Panels and picking ----
  const closePanel = () => {
    ui.panel = null;
    ui.assert = null;
    ui.page = null;
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
      } else if (tool === "page") {
        const id = nextId++;
        ui.page = { id, info: null, matcher: "toHaveURL", expected: "", not: false, error: null };
        ui.pending = id;
        post({ action: "page-info", id });
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
      id, target, candidates, info: null, matcher: "toBeVisible", expected: "", attribute: null, countIndex: 0,
      cssName: "", cssValue: "", not: false, error: null,
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
`;
