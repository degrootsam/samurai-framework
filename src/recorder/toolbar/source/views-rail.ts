/** Views: the chip and the rail. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const VIEWS_RAIL_JS = String.raw`  // ---- Views ----
  const toolOn = (tool) =>
    tool === "assert" ? ui.picking || ui.panel === "assert" : tool === "insert" ? ui.panel === "insert" || ui.panel === "new" : ui.panel === tool;

  const chipView = () =>
    h("div", { class: "chip" },
      h("span", { "data-grip": true, title: "Drag to move" }, "⋮⋮"),
      h("span", { class: paused() ? "dot pause" : "dot" }),
      (paused() ? "Paused" : "Rec") + " · " + state.steps + (state.steps === 1 ? " step" : " steps"),
      h("button", { class: "chev", "data-action": "expand", title: "Expand" }, "⌄"));

  const railView = () => {
    const tool = (action, icon, label) =>
      h("button", { class: toolOn(action) ? "b on" : "b", "data-action": action, disabled: paused() }, ico(icon), label);
    return h("div", { class: paused() || state.resumeQuestion ? "rail wide" : "rail" },
      h("div", { class: "top" },
        h("span", { "data-grip": true, title: "Drag to move" }, "⋮⋮⋮"),
        h("button", { class: "chev", "data-action": "collapse", title: "Collapse" }, "⌃")),
      h("div", { class: "st" }, h("span", { class: paused() ? "dot pause" : "dot" }), paused() ? "Paused" : "Recording"),
      paused() && h("div", { class: "note" }, "Nothing you do now is recorded."),
      state.resumeQuestion && [
        h("div", { class: "note" }, "Add a step that opens this page?"),
        h("div", { class: "ask" },
          h("button", { class: "yes", "data-action": "resume-yes" }, "Yes"),
          h("button", { "data-action": "resume-no" }, "No")),
      ],
      h("div", { class: "sep" }),
      paused()
        ? h("button", { class: "b on", "data-action": "resume" }, ico("▶"), "Resume")
        : h("button", { class: "b", "data-action": "pause" }, ico("❚❚"), "Pause"),
      tool("assert", "✓", "Assert"),
      ui.picking && h("div", { class: "note" }, "Click an element · Esc cancels"),
      tool("insert", "{x}", "Insert"),
      tool("wait", "⏱", "Wait"),
      tool("screenshot", "◉", "Screenshot"),
      h("div", { class: "sep" }),
      h("button", { class: "b stop", "data-action": "stop" }, ico("■"), "Stop"));
  };
`;
