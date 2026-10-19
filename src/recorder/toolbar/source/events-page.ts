/** Events on the page, seen in the capture phase. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const EVENTS_PAGE_JS = String.raw`  // ---- Events on the page (window capture runs before the page's and the capture script's listeners) ----
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
`;
