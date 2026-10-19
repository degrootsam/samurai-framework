/** DOM helpers: the shadow root, element builder and icons. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const DOM_JS = String.raw`  // ---- DOM ----
  const h = (tag, props, ...kids) => {
    const node = document.createElement(tag);
    for (const key in props || {}) {
      const value = props[key];
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "value" || key === "checked" || key === "disabled" || key === "selected") node[key] = value;
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false || kid === "") continue;
      node.append(typeof kid === "string" ? document.createTextNode(kid) : kid);
    }
    return node;
  };
  const ico = (text) => h("span", { class: "ico" }, text);

  // Styles go through the CSSOM (property by property, and a constructed sheet), which a page's CSP does not
  // block, unlike a style attribute or a <style> element without 'unsafe-inline'
  const host = document.createElement("samurai-recorder-toolbar");
  const HOST_STYLE = [
    ["all", "initial"], ["display", "block"], ["position", "fixed"], ["top", "0"], ["left", "0"], ["width", "0"],
    ["height", "0"], ["overflow", "visible"], ["z-index", "2147483647"],
  ];
  for (const [name, value] of HOST_STYLE) host.style.setProperty(name, value, "important");
  const root = host.attachShadow({ mode: "closed" });
  const frame = h("div", { class: "frame" });
  const container = h("div", { class: "ui" });
  const outline = h("div", { class: "outline", hidden: true });
  const toast = h("div", { class: "toast ui", hidden: true });
  const notices = h("div", { class: "notices ui" });
  let adopted = false;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    adopted = root.adoptedStyleSheets.length === 1;
  } catch (err) {
    adopted = false;
  }
  // Without constructed sheets: a <style> element, which a strict CSP blocks
  root.append(...(adopted ? [] : [h("style", null, CSS)]), frame, outline, container, toast, notices);

  const viewport = () => ({ w: frame.clientWidth || innerWidth, h: frame.clientHeight || innerHeight });
`;
