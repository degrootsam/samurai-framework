/** Events inside the toolbar. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const EVENTS_TOOLBAR_JS = String.raw`  // ---- Events inside the toolbar; none of them reach the page's bubbling listeners ----
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
`;
