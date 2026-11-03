import type { ElementHandle } from "../script/element-handle.js";
import type { CallInPage } from "./chain-resolver.js";
import type { FilterTests, Selector, TextCriterion } from "./selector.js";

/** What `filter()` and the options of `locator(selector, options)` take; `has` and `hasNot` are locators searched inside each candidate */
export interface FilterOptions<L = unknown> {
  /** Keeps elements whose text contains this string (case-insensitive, whitespace collapsed), or matches this RegExp (tested on the text as it is) */
  hasText?: TextCriterion;
  /** Keeps elements whose text does not contain / match it */
  hasNotText?: TextCriterion;
  /** Keeps elements that contain a match of this locator, searched inside the element */
  has?: L;
  /** Keeps elements that contain no match of this locator */
  hasNot?: L;
}

const OPTION_NAMES = ["hasText", "hasNotText", "has", "hasNot"] as const;

function checkText(name: string, value: unknown): void {
  if (
    value !== undefined &&
    typeof value !== "string" &&
    !(value instanceof RegExp)
  ) {
    throw new TypeError(`filter(): ${name} must be a string or a RegExp`);
  }
}

/** The `filter` step for the options; `chainOf` reads the chain of a `has` / `hasNot` locator (and rejects one with fallbacks) */
export function filterSelector<L>(
  options: FilterOptions<L>,
  chainOf: (locator: L, option: string) => readonly Selector[],
): Selector {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("filter(): options must be an object");
  }
  const given = OPTION_NAMES.filter((name) => options[name] !== undefined);
  if (given.length === 0) {
    throw new TypeError(
      "filter(): give at least one of hasText, hasNotText, has or hasNot",
    );
  }
  checkText("hasText", options.hasText);
  checkText("hasNotText", options.hasNotText);
  const tests: FilterTests = {};
  if (options.hasText !== undefined) tests.hasText = options.hasText;
  if (options.hasNotText !== undefined) tests.hasNotText = options.hasNotText;
  if (options.has !== undefined) tests.has = chainOf(options.has, "has");
  if (options.hasNot !== undefined)
    tests.hasNot = chainOf(options.hasNot, "hasNot");
  return { kind: "filter", ...tests };
}

/**
 * Function declaration run in the page as `(elements, hasText, hasNotText)`: the elements whose
 * `textContent` passes both tests. A string test is a substring match with whitespace collapsed and case
 * ignored (Playwright's `hasText`); a RegExp is tested on the text as it is, without its `g` and `y` flags.
 */
export const TEXT_FILTER = `(elements, hasText, hasNotText) => {
  const collapse = (text) => String(text).replace(/\\s+/g, " ").trim().toLowerCase();
  const found = (el, wanted) => {
    const text = el.textContent ?? "";
    return typeof wanted === "string"
      ? collapse(text).includes(collapse(wanted))
      : new RegExp(wanted.source, wanted.flags.replace(/[gy]/g, "")).test(text);
  };
  return elements.filter((el) =>
    (hasText === undefined || found(el, hasText)) &&
    (hasNotText === undefined || !found(el, hasNotText)));
}`;

/** What applying a filter needs: the page, and a search of a chain inside one element */
export interface FilterContext {
  call: CallInPage;
  /** The first match of `chain` inside `start` (its first step is scoped to it), or none */
  findInside(
    chain: readonly Selector[],
    start: ElementHandle,
  ): Promise<ElementHandle[]>;
}

/** The candidates that pass every test of the filter, in their order */
export async function applyFilter(
  candidates: readonly ElementHandle[],
  tests: FilterTests,
  { call, findInside }: FilterContext,
): Promise<ElementHandle[]> {
  let kept = [...candidates];
  if (tests.hasText !== undefined || tests.hasNotText !== undefined) {
    kept = await call<ElementHandle[]>(TEXT_FILTER, [
      kept,
      tests.hasText,
      tests.hasNotText,
    ]);
  }
  for (const [chain, wanted] of [
    [tests.has, true],
    [tests.hasNot, false],
  ] as const) {
    if (!chain) continue;
    const passing: ElementHandle[] = [];
    for (const candidate of kept) {
      if ((await findInside(chain, candidate)).length > 0 === wanted)
        passing.push(candidate);
    }
    kept = passing;
  }
  return kept;
}
