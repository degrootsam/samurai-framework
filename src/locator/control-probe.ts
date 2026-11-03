/**
 * Page-side branch of the actionability probe for checkboxes, radios and switches (`ProbeOptions.control`).
 * These are often hidden on purpose: a native input at `opacity: 0` (or 1px, or `display: none`) with a styled
 * `<label>` on top. A user clicks the label, so the probe accepts the input itself or any of its labels as the
 * click target: the first one that is shown and reached by a click at its centre. The reported `box` is that
 * target's, so the click lands where a user's would. Other actions keep the stricter probe.
 *
 * Runs inside `PROBE_ELEMENT` with `el` and `options` in scope; a string for the same reason it is (no helpers).
 */
export const CONTROL_PROBE_BRANCH = `
  if (options.control) {
    const labels = Array.from(el.labels || []);
    const shown = (node) => {
      const r = node.getBoundingClientRect();
      const s = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    };
    const candidates = [el, ...labels].filter(shown);
    const reaches = (node, top) => node === top || node.contains(top) ||
      (node === el && labels.some((label) => label === top || label.contains(top)));
    const bringIntoView = (node) => {
      const r = node.getBoundingClientRect();
      const inside = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
      if (options.scroll && !inside) node.scrollIntoView({ block: "center", inline: "center" });
    };
    let chosen = candidates[0] || el;
    let hitTarget = null;
    if (options.hitTest) {
      for (const node of candidates) {
        bringIntoView(node);
        const r = node.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const hit = !top ? "nothing" : reaches(node, top) ? "self"
          : top.tagName.toLowerCase() + (top.id ? "#" + top.id : "") +
            Array.from(top.classList, (name) => "." + name).join("");
        if (node === candidates[0]) hitTarget = hit;
        if (hit === "self") { chosen = node; hitTarget = "self"; break; }
      }
    } else if (candidates.length) {
      bringIntoView(chosen);
    }
    const box = chosen.getBoundingClientRect();
    return {
      attached: true, visible: candidates.length > 0,
      enabled: !el.matches(":disabled") && el.getAttribute("aria-disabled") !== "true",
      editable: false,
      box: { x: box.left, y: box.top, width: box.width, height: box.height },
      hitTarget,
    };
  }`;
