import type { Arg } from "../script/serialize.js";
import { ATTRIBUTE_LOCATE } from "./attribute-locator.js";
import { LABEL_LOCATE } from "./label-locator.js";
import type { Selector } from "./selector.js";
import { TEXT_LOCATE } from "./text-locator.js";

/** A step the framework searches in the page: the function (run as `(starts, ...args)`) and its arguments after the start nodes */
export interface PageSearch {
  fn: string;
  args: Arg[];
}

type TextStep = Extract<Selector, { kind: "text" | "label" | "attribute" }>;

/** The arguments of the text-matching searches: `(value, match, ignoreCase)`, and the attribute for `attribute` steps */
function textArgs(selector: TextStep): Arg[] {
  const args: Arg[] = [selector.value, selector.match, selector.ignoreCase];
  return selector.kind === "attribute" ? [...args, selector.attribute] : args;
}

/** The text search of a `text` step, which the browser's own `innerText` locator cannot do (or does not exist) */
export function textSearch(
  selector: Extract<Selector, { kind: "text" }>,
): PageSearch {
  return { fn: TEXT_LOCATE, args: textArgs(selector) };
}

/**
 * The page-side search for a step the browser cannot locate by itself: labels, attributes and RegExp texts.
 * `undefined` when the browser's locator does the job
 */
export function pageSearch(selector: Selector): PageSearch | undefined {
  switch (selector.kind) {
    case "label":
      return { fn: LABEL_LOCATE, args: textArgs(selector) };
    case "attribute":
      return { fn: ATTRIBUTE_LOCATE, args: textArgs(selector) };
    case "text":
      return typeof selector.value === "string"
        ? undefined
        : textSearch(selector);
    default:
      return undefined;
  }
}
