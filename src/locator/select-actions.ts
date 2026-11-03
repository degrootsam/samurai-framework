import { resolveTimeout } from "../config/timeouts.js";
import { waitUntil, WaitTimeoutError } from "../wait/wait-until.js";
import type { ActionOptions } from "./actionability.js";
import { callOnExistingElement, type ElementAccess } from "./element-access.js";
import { SELECT_CHECKS } from "./page-scripts.js";

/** One option to select: a string matches the option's value or its label; an object must match every field it names */
export type SelectOptionValue =
  string | { value?: string; label?: string; index?: number };

type Wanted = { value?: string; label?: string; index?: number; any?: string };

type Outcome =
  { values: string[] } | { notSelect: true } | { missing: Wanted[] };

/**
 * Body run in the page as `(el, wanted) => { ... }`: selects the matching options of a `<select>`, then fires
 * `input` and `change` once each. Selects nothing and reports what is missing when a wanted option is not there.
 */
const SELECT_BODY = `
  if (el.tagName !== "SELECT") return { notSelect: true };
  const options = Array.from(el.options);
  const matches = (option, want, index) =>
    (want.any === undefined || option.value === want.any || option.label === want.any) &&
    (want.value === undefined || option.value === want.value) &&
    (want.label === undefined || option.label === want.label) &&
    (want.index === undefined || index === want.index);
  const missing = wanted.filter((want) => !options.some((option, i) => matches(option, want, i)));
  if (missing.length) return { missing };
  let chosen = options.filter((option, i) => wanted.some((want) => matches(option, want, i)));
  if (!el.multiple) chosen = chosen.slice(0, 1);
  el.focus();
  for (const option of options) option.selected = chosen.includes(option);
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { values: Array.from(el.selectedOptions, (option) => option.value) };`;

function normalise(values: SelectOptionValue | SelectOptionValue[]): Wanted[] {
  const list = Array.isArray(values) ? values : [values];
  return list.map((item) => {
    if (typeof item === "string") return { any: item };
    if (typeof item !== "object" || item === null) {
      throw new TypeError(
        `selectOption(): expected a string, { value, label, index } or an array of those, got ${item === null ? "null" : typeof item}`,
      );
    }
    const { value, label, index } = item;
    return {
      ...(value !== undefined && { value }),
      ...(label !== undefined && { label }),
      ...(index !== undefined && { index }),
    };
  });
}

function describeWanted(want: Wanted): string {
  return want.any !== undefined
    ? JSON.stringify(want.any)
    : JSON.stringify(want);
}

/**
 * Selects the options of a `<select>` (or `<select multiple>`, whose selection it replaces) and returns the values
 * now selected. Waits until the select is visible and enabled, and until every wanted option exists.
 */
export async function selectOptions(
  access: ElementAccess,
  values: SelectOptionValue | SelectOptionValue[],
  options?: ActionOptions,
): Promise<string[]> {
  const wanted = normalise(values);
  await access.waitForActionable(
    "selectOption",
    SELECT_CHECKS,
    { scroll: true, hitTest: false },
    options,
  );
  const timeout = await resolveTimeout(options?.timeout);
  const attempt = () =>
    callOnExistingElement<Outcome>(
      access,
      `return ((el, wanted) => { ${SELECT_BODY} })(el, ${JSON.stringify(wanted)});`,
      "selectOption",
    );
  let outcome: Outcome;
  try {
    outcome = await waitUntil(attempt, (current) => !("missing" in current), {
      timeout,
    });
  } catch (err) {
    if (!(err instanceof WaitTimeoutError)) throw err;
    const last = err.last as Outcome | undefined;
    const missing = last && "missing" in last ? last.missing : [];
    throw new Error(
      `selectOption(): no option matches ${missing.map(describeWanted).join(", ")} in ${access.selector} within ${timeout}ms`,
    );
  }
  if ("notSelect" in outcome) {
    throw new Error(`selectOption(): ${access.selector} is not a <select>`);
  }
  return (outcome as { values: string[] }).values;
}
