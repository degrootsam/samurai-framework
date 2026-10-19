/** Attaching the host to the document. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const ATTACH_JS = String.raw`  // ---- Attach ----
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
  listen(window, "load", attach);`;
