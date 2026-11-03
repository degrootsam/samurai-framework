/**
 * The implicit ARIA role of an element, for the in-page role search (`getByRole` with a RegExp name, `exact: false`,
 * or a state option). A table of tags, a few attribute rules and a few context rules, in the spirit of HTML-AAM;
 * the browser's own accessibility tree is the reference for the plain `getByRole(role, { name })`, which does not use this.
 */

/** Tags with one role whatever their attributes */
export const TAG_ROLES: Readonly<Record<string, string>> = {
  address: "group",
  article: "article",
  aside: "complementary",
  blockquote: "blockquote",
  button: "button",
  caption: "caption",
  code: "code",
  dd: "definition",
  del: "deletion",
  details: "group",
  dfn: "term",
  dialog: "dialog",
  dt: "term",
  em: "emphasis",
  fieldset: "group",
  figure: "figure",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  hgroup: "group",
  hr: "separator",
  ins: "insertion",
  li: "listitem",
  main: "main",
  mark: "mark",
  menu: "list",
  meter: "meter",
  nav: "navigation",
  ol: "list",
  optgroup: "group",
  option: "option",
  output: "status",
  p: "paragraph",
  progress: "progressbar",
  search: "search",
  strong: "strong",
  sub: "subscript",
  sup: "superscript",
  table: "table",
  tbody: "rowgroup",
  tfoot: "rowgroup",
  thead: "rowgroup",
  textarea: "textbox",
  time: "time",
  tr: "row",
  ul: "list",
};

/** `<input type>` to role; an unknown type is a textbox, `hidden` and `file` have none */
const INPUT_ROLES: Readonly<Record<string, string>> = {
  button: "button",
  checkbox: "checkbox",
  image: "button",
  number: "spinbutton",
  radio: "radio",
  range: "slider",
  reset: "button",
  search: "searchbox",
  submit: "button",
};

/** Input types that have no role at all */
const INPUT_TYPES_WITHOUT_ROLE: readonly string[] = [
  "hidden",
  "file",
  "color",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
];

/** Landmarks that stop a `header` / `footer` from being the page's banner / content info */
const SECTIONING_TAGS: readonly string[] = [
  "article",
  "aside",
  "main",
  "nav",
  "section",
];
const SECTIONING_ROLES: readonly string[] = [
  "article",
  "complementary",
  "main",
  "navigation",
  "region",
];

/**
 * Roles whose accessible name may come from their content (ARIA 1.2 "name from: contents"), which
 * `accessibleName` reads for the element itself, not only for what it embeds.
 */
export const NAME_FROM_CONTENT_ROLES: readonly string[] = [
  "button",
  "cell",
  "checkbox",
  "columnheader",
  "gridcell",
  "heading",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "row",
  "rowheader",
  "switch",
  "tab",
  "tooltip",
  "treeitem",
];

/**
 * Page-side source: `roleOf(el)` is the role of an element: the first token of `role=""`, else the implicit role,
 * else `""` (no role). Reads only `localName`, `getAttribute`, `hasAttribute` and `parentElement`, so a unit test can
 * run it on a fake element. `div` and `span` are `generic`.
 */
export const ROLE_OF_JS = `
  const TAG_ROLES = ${JSON.stringify(TAG_ROLES)};
  const INPUT_ROLES = ${JSON.stringify(INPUT_ROLES)};
  const NO_ROLE_INPUTS = ${JSON.stringify(INPUT_TYPES_WITHOUT_ROLE)};
  const SECTIONING_TAGS = ${JSON.stringify(SECTIONING_TAGS)};
  const SECTIONING_ROLES = ${JSON.stringify(SECTIONING_ROLES)};
  const hasText = (el, name) => (el.getAttribute(name) || "").trim() !== "";
  const isNamed = (el) => hasText(el, "aria-label") || hasText(el, "aria-labelledby");
  const insideSectioning = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const explicit = (n.getAttribute("role") || "").trim().split(/\\s+/)[0];
      if (SECTIONING_TAGS.includes(n.localName) || SECTIONING_ROLES.includes(explicit)) return true;
    }
    return false;
  };
  const inGrid = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const explicit = (n.getAttribute("role") || "").trim().split(/\\s+/)[0];
      if (explicit === "grid" || explicit === "treegrid") return true;
    }
    return false;
  };
  const implicitRole = (el) => {
    const tag = el.localName;
    switch (tag) {
      case "a":
      case "area":
        return el.hasAttribute("href") ? "link" : tag === "a" ? "generic" : "";
      case "input": {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        if (NO_ROLE_INPUTS.includes(type)) return "";
        const mapped = INPUT_ROLES[type];
        if (mapped) return type === "search" && el.hasAttribute("list") ? "combobox" : mapped;
        return el.hasAttribute("list") ? "combobox" : "textbox";
      }
      case "select":
        return el.hasAttribute("multiple") || Number(el.getAttribute("size")) > 1 ? "listbox" : "combobox";
      case "datalist":
        return "listbox";
      case "img":
        return el.getAttribute("alt") === "" && !el.hasAttribute("title") ? "presentation" : "img";
      case "section":
        return isNamed(el) ? "region" : "";
      case "form":
        return isNamed(el) ? "form" : "";
      case "header":
        return insideSectioning(el) ? "" : "banner";
      case "footer":
        return insideSectioning(el) ? "" : "contentinfo";
      case "td":
        return inGrid(el) ? "gridcell" : "cell";
      case "th": {
        const scope = (el.getAttribute("scope") || "").toLowerCase();
        return scope === "row" || scope === "rowgroup" ? "rowheader" : "columnheader";
      }
      case "div":
      case "span":
        return "generic";
      default:
        return TAG_ROLES[tag] ?? "";
    }
  };
  const roleOf = (el) => {
    const explicit = (el.getAttribute("role") || "").trim().split(/\\s+/)[0];
    return explicit ? explicit.toLowerCase() : implicitRole(el);
  };`;
