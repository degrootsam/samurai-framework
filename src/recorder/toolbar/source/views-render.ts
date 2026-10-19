/** Views: warnings, notices and the render pass. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const VIEWS_RENDER_JS = String.raw`  // Notice nodes live as long as their warning: rebuilding them would make screen readers announce each alert again
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
`;
