/** Where the rail and panels sit in the window. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const PLACEMENT_JS = String.raw`  // ---- Placement ----
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
`;
