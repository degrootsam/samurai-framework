/** Variable and field naming helpers. A slice of the toolbar function: it shares one closure with its neighbours, see `../source.ts`. */
export const NAMES_JS = String.raw`  // ---- Names and labels ----
  const words = (text) => String(text).replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const camel = (text) => words(text).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("");
  const snake = (text) => words(text).map((w) => w.toUpperCase()).join("_");
  const variableName = (text) => (/^[A-Za-z_$][\w$]*$/.test(text.trim()) ? text.trim() : camel(text));
  const fieldName = (el) => labelTexts(el)[0] || el.getAttribute("name") || el.id || "";
  const fieldLabel = (el) => {
    const text = labelTexts(el)[0] || el.getAttribute("placeholder") || el.getAttribute("name") || el.id || "field";
    return text.length > 40 ? text.slice(0, 39) + "…" : text;
  };
`;
