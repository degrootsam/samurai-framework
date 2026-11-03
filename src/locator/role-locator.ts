import { ACCESSIBLE_NAME_JS } from "./accessible-name.js";
import { DOCUMENT_ORDER_JS, MATCHING_JS, ROOTS_JS } from "./page-search.js";

/** What `getByRole` takes beside the role */
export interface RoleOptions {
  /**
   * The accessible name. A string is matched in full and case-sensitively (whitespace normalised) unless `exact` is
   * false; a RegExp is tested on the name as written (flags kept, `g` and `y` dropped) and ignores `exact`
   */
  name?: string | RegExp;
  /**
   * `true` (the default) keeps the full-string, case-sensitive name match; `false` switches this call to Playwright's
   * matching: a case-insensitive substring. This is the one intentional difference from Playwright, whose default is
   * the case-insensitive substring. Does not apply to a RegExp
   * @default true
   */
  exact?: boolean;
  /** The heading level: `h1` to `h6`, else `aria-level` */
  level?: number;
  /** `checked` of a checkbox, radio or switch, from the element's state or `aria-checked`; `"mixed"` for indeterminate */
  checked?: boolean | "mixed";
  /** `aria-pressed` of a toggle button */
  pressed?: boolean | "mixed";
  /** `aria-expanded` */
  expanded?: boolean;
  /** `selected` of an option, or `aria-selected` */
  selected?: boolean;
  /** Disabled by `disabled` (also through a disabled fieldset) or by `aria-disabled` on it or an ancestor */
  disabled?: boolean;
  /** Also match elements that are not rendered or are hidden from assistive technology (`aria-hidden`). @default false */
  includeHidden?: boolean;
}

/** A `role` step: the options that are not their default, so the plain steps stay `{ kind, role, name }` */
export interface RoleSelector extends Omit<
  RoleOptions,
  "exact" | "includeHidden"
> {
  kind: "role";
  role: string;
  /** Present (as `false`) only when the name is matched loosely */
  exact?: false;
  /** Present (as `true`) only when hidden elements count */
  includeHidden?: true;
}

const STATE_OPTIONS = [
  "level",
  "checked",
  "pressed",
  "expanded",
  "selected",
  "disabled",
] as const;

function checkOption(name: string, ok: boolean, expected: string): void {
  if (!ok) throw new TypeError(`getByRole(): ${name} must be ${expected}`);
}

/** The `role` step for `getByRole(role, options)`; `nonEmpty` rejects a blank role */
export function buildRoleSelector(
  role: string,
  options: RoleOptions,
): RoleSelector {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("getByRole(): options must be an object");
  }
  const { name, exact = true, includeHidden = false } = options;
  const step: RoleSelector = { kind: "role", role };
  if (name !== undefined) {
    checkOption(
      "name",
      typeof name === "string" || name instanceof RegExp,
      "a string or a RegExp",
    );
    step.name =
      name instanceof RegExp
        ? new RegExp(name.source, name.flags.replace(/[gy]/g, ""))
        : name;
  }
  if (exact === false) step.exact = false;
  if (includeHidden === true) step.includeHidden = true;
  const { level, checked, pressed, expanded, selected, disabled } = options;
  checkOption(
    "level",
    level === undefined || (Number.isInteger(level) && level >= 1),
    "a positive integer",
  );
  for (const [key, value] of [
    ["checked", checked],
    ["pressed", pressed],
  ] as const) {
    checkOption(
      key,
      value === undefined || typeof value === "boolean" || value === "mixed",
      'a boolean or "mixed"',
    );
  }
  for (const [key, value] of [
    ["expanded", expanded],
    ["selected", selected],
    ["disabled", disabled],
  ] as const) {
    checkOption(
      key,
      value === undefined || typeof value === "boolean",
      "a boolean",
    );
  }
  for (const key of STATE_OPTIONS) {
    if (options[key] !== undefined)
      Object.assign(step, { [key]: options[key] });
  }
  return step;
}

/** True when the browser's accessibility locator does the whole job: no RegExp, no loose match, no state, nothing hidden */
export function isNativeRole(selector: RoleSelector): boolean {
  return (
    (selector.name === undefined || typeof selector.name === "string") &&
    selector.exact === undefined &&
    selector.includeHidden === undefined &&
    STATE_OPTIONS.every((key) => selector[key] === undefined)
  );
}

/** The options of a step as the page-side search takes them */
export function roleSearchArgs(selector: RoleSelector) {
  const { kind: _kind, role: _role, ...options } = selector;
  return [selector.role, options] as const;
}

/** Page-side source: whether `el` has the state `want` in `property` (`checked`, `pressed`, ...) */
const STATES_JS = `
  const tokenState = (value) => (value === "true" ? true : value === "mixed" ? "mixed" : false);
  const ancestorsOrSelf = function* (el) { for (let n = el; n; n = n.parentElement) yield n; };
  const stateOf = {
    checked: (el) => {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (el.localName === "input" && (type === "checkbox" || type === "radio")) return el.indeterminate ? "mixed" : el.checked;
      return tokenState(el.getAttribute("aria-checked"));
    },
    pressed: (el) => tokenState(el.getAttribute("aria-pressed")),
    expanded: (el) => el.getAttribute("aria-expanded") === "true" || (el.localName === "details" && el.open === true),
    selected: (el) => (el.localName === "option" ? el.selected : el.getAttribute("aria-selected") === "true"),
    disabled: (el) => {
      if (typeof el.matches === "function" && el.matches(":disabled")) return true;
      for (const n of ancestorsOrSelf(el)) if (n.getAttribute("aria-disabled") === "true") return true;
      return false;
    },
    level: (el) => {
      const heading = /^h([1-6])$/.exec(el.localName);
      const own = Number(el.getAttribute("aria-level"));
      return own > 0 ? own : heading ? Number(heading[1]) : 0;
    },
  };`;

/**
 * Function declaration run in the page as `(starts, role, options)`; returns the elements with the role that pass
 * every option, unique and in document order. This is the search for what the browser's accessibility locator cannot
 * do (see `isNativeRole`); it is the same in Firefox and Chrome, which differ on ignored nodes (Chrome's locator
 * also returns `aria-hidden` elements). The role is the `role` attribute's first token, else the implicit role (`ROLE_OF_JS`).
 *
 * A string, so the transpiler cannot inject helpers that do not exist in the page.
 */
export const ROLE_LOCATE = `(starts, wantedRole, options) => {
  ${ACCESSIBLE_NAME_JS}
  ${STATES_JS}
  const hasName = options.name !== undefined;
  const value = hasName ? options.name : "";
  const match = options.exact === false ? "partial" : "full";
  const ignoreCase = options.exact === false;
  ${MATCHING_JS}
  ${ROOTS_JS}
  const role = wantedRole.toLowerCase();
  const seen = new Set();
  const matches = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll("*")) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (roleOf(el) !== role) continue;
      if (!options.includeHidden && isHidden(el)) continue;
      let ok = true;
      for (const key of ["checked", "pressed", "expanded", "selected", "disabled", "level"]) {
        if (options[key] !== undefined && stateOf[key](el) !== options[key]) { ok = false; break; }
      }
      if (ok && hasName && !textMatches(accessibleName(el))) ok = false;
      if (ok) matches.push(el);
    }
  }
  return matches.sort(${DOCUMENT_ORDER_JS});
}`;
