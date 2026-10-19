/** Dragging the rail. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const DRAG_JS = String.raw`  // ---- Drag ----
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
`;
