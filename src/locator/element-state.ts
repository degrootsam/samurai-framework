import type { RemoteValue } from "../types/bidi-modules/script.js";

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementState {
  attached: boolean;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  /** Viewport coordinates after any scroll; null when not attached */
  box: ElementBox | null;
  /**
   * "self" when a click at the element's centre reaches it, otherwise a description of
   * the covering element ("nothing" when no element is there); null when not checked
   */
  hitTarget: string | null;
}

export interface ProbeOptions {
  /** Scroll the element into view first when it is not fully inside the viewport */
  scroll: boolean;
  /** Check which element receives a click at the element's centre */
  hitTest: boolean;
}

export type WaitForState = "attached" | "detached" | "visible" | "hidden";
export type CheckName = "attached" | "visible" | "stable" | "enabled" | "editable" | "hit target";
export type CheckResult = "pass" | "fail" | "pending";
/** Results keyed by check name, in the order the checks were evaluated */
export type CheckResults = Partial<Record<CheckName, CheckResult>>;

const TEXT_INPUT_TYPES = ["text", "search", "email", "url", "tel", "password", "number"];

const SCROLL_INTO_VIEW = `
  const before = el.getBoundingClientRect();
  const inViewport = before.top >= 0 && before.left >= 0 &&
    before.bottom <= window.innerHeight && before.right <= window.innerWidth;
  if (!inViewport) el.scrollIntoView({ block: "center", inline: "center" });`;

const HIT_TEST = `
  const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  hitTarget = !top ? "nothing"
    : top === el || el.contains(top) ? "self"
    : top.tagName.toLowerCase() + (top.id ? "#" + top.id : "") +
      Array.from(top.classList, (name) => "." + name).join("");`;

/** Script returning the element's state as a JSON string in one round trip */
export function elementStateScript(
  elementExpression: string,
  { scroll, hitTest }: ProbeOptions,
): string {
  return `(() => {
  const el = ${elementExpression};
  if (!el) {
    return JSON.stringify({ attached: false, visible: false, enabled: false, editable: false, box: null, hitTarget: null });
  }${scroll ? SCROLL_INTO_VIEW : ""}
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const visible = rect.width > 0 && rect.height > 0 &&
    style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  const enabled = !el.matches(":disabled") && el.getAttribute("aria-disabled") !== "true";
  const tag = el.tagName.toLowerCase();
  const typeable = Boolean(
    (tag === "input" && ${JSON.stringify(TEXT_INPUT_TYPES)}.includes((el.getAttribute("type") || "text").toLowerCase())) ||
    tag === "textarea" || el.isContentEditable);
  const editable = Boolean(enabled && !el.readOnly && typeable);
  let hitTarget = null;${hitTest ? HIT_TEST : ""}
  return JSON.stringify({
    attached: true, visible, enabled, editable,
    box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    hitTarget,
  });
})()`;
}

/** Parses the probe result; throws on anything that is not a complete state */
export function parseElementState(value: RemoteValue): ElementState {
  if (value.type !== "string") {
    throw new Error(`Expected an element state string but received "${value.type}"`);
  }
  let state: Partial<ElementState>;
  try {
    state = JSON.parse(value.value) as Partial<ElementState>;
  } catch {
    throw new Error(`Malformed element state: ${value.value}`);
  }
  const flags = ["attached", "visible", "enabled", "editable"] as const;
  if (
    typeof state !== "object" ||
    state === null ||
    flags.some((flag) => typeof state[flag] !== "boolean") ||
    !("box" in state) ||
    !("hitTarget" in state)
  ) {
    throw new Error(`Malformed element state: ${value.value}`);
  }
  return state as ElementState;
}

function sameBox(a: ElementBox | null, b: ElementBox | null) {
  return (
    a !== null &&
    b !== null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

function checkPasses(name: CheckName, current: ElementState, previous: ElementState | undefined) {
  switch (name) {
    case "attached":
      return current.attached;
    case "visible":
      return current.visible;
    case "stable":
      return sameBox(current.box, previous?.box ?? null);
    case "enabled":
      return current.enabled;
    case "editable":
      return current.editable;
    case "hit target":
      return current.hitTarget === "self";
  }
}

/** Evaluates the required checks in order; after the first failure the rest are pending */
export function evaluateChecks(
  required: readonly CheckName[],
  current: ElementState,
  previous: ElementState | undefined,
): CheckResults {
  const results: CheckResults = {};
  let failed = false;
  for (const name of required) {
    if (failed) {
      results[name] = "pending";
      continue;
    }
    const pass = checkPasses(name, current, previous);
    results[name] = pass ? "pass" : "fail";
    failed = !pass;
  }
  return results;
}

export function allPass(results: CheckResults): boolean {
  return Object.values(results).every((result) => result === "pass");
}
