import { z } from "zod";
import { expect } from "../../assert/expect.js";
import type { Expectation, PageExpectation } from "../../steps/model.js";
import { writtenText } from "../recording.js";
import { defineTool, shortMessage } from "./context.js";

/** Matchers on one element that need nothing more */
const PLAIN = [
  "toBeVisible",
  "toBeHidden",
  "toBeEnabled",
  "toBeChecked",
  "toBeFocused",
  "toBeDisabled",
  "toBeEditable",
  "toBeAttached",
  "toBeInViewport",
  "toBeEmpty",
] as const;
/** Matchers that compare text: `expected` is the text */
const TEXT = [
  "toHaveText",
  "toContainText",
  "toHaveValue",
  "toHaveId",
  "toHaveClass",
  "toHaveAccessibleName",
  "toHaveAccessibleDescription",
] as const;
/** Matchers that also take a `name`: the CSS property or the attribute */
const NAMED = ["toHaveCSS", "toHaveAttribute"] as const;
const PAGE = ["toHaveURL", "toHaveTitle"] as const;
/** What may be checked of a field that holds a secret: its state, never its value */
const STATE_ONLY = [
  "toBeVisible",
  "toBeHidden",
  "toBeEnabled",
  "toBeDisabled",
  "toBeEditable",
  "toBeFocused",
  "toBeAttached",
  "toBeInViewport",
];

const MATCHERS = [...PLAIN, ...TEXT, ...NAMED, ...PAGE] as const;
type Matcher = (typeof MATCHERS)[number];
type Check = Record<string, (...args: unknown[]) => Promise<void>>;

const isIn = (list: readonly string[], matcher: string): boolean =>
  list.includes(matcher);

/** The codec's expectation the call stands for, or why it is not a complete call */
function expectationOf(
  matcher: Matcher,
  expected: string | undefined,
  name: string | undefined,
): Expectation | PageExpectation | string {
  if (isIn(PLAIN, matcher))
    return expected === undefined && name === undefined
      ? ({ matcher } as Expectation)
      : `${matcher} takes no expected value`;
  if (expected === undefined) return `${matcher} needs expected`;
  if (isIn(NAMED, matcher))
    return name === undefined || name === ""
      ? `${matcher} needs name (the ${matcher === "toHaveCSS" ? "CSS property" : "attribute"})`
      : ({ matcher, name, expected } as Expectation);
  if (name !== undefined) return `${matcher} takes no name`;
  return { matcher, expected } as Expectation | PageExpectation;
}

export const expectTool = defineTool({
  name: "expect",
  description:
    'Check something about an element of the latest snapshot (or about the page, with target "page" and ' +
    "toHaveURL or toHaveTitle) and add the check to the test. The check runs on the live page first; " +
    "if it does not hold nothing is written. toHaveText is the whole text, toContainText a part of it.",
  inputSchema: z.object({
    target: z
      .string()
      .describe('A reference from the latest snapshot (e12), or "page"'),
    matcher: z.enum(MATCHERS),
    expected: z
      .string()
      .optional()
      .describe("The text, URL, title, value or class to compare with"),
    name: z
      .string()
      .optional()
      .describe("toHaveCSS: the property; toHaveAttribute: the attribute"),
    not: z.boolean().optional().describe("Expect the opposite"),
  }),
  async execute({ target, matcher, expected, name, not }, context) {
    const onPage = target.trim() === "page";
    if (onPage !== isIn(PAGE, matcher))
      return {
        ok: false,
        error: onPage
          ? `expect(): ${matcher} is about an element; give a reference, not "page"`
          : `expect(): ${matcher} is about the page; use target "page"`,
      };
    const expectation = expectationOf(matcher, expected, name);
    if (typeof expectation === "string")
      return { ok: false, error: `expect(): ${expectation}` };
    const options = { timeout: context.actionTimeout };
    const negate = not === true;
    const verdict = negate ? "does not satisfy" : "satisfies";

    if (onPage) {
      try {
        const page = negate ? expect(context.page).not : expect(context.page);
        await (page as unknown as Check)[matcher]!(expected, options);
      } catch (error) {
        return {
          ok: false,
          error: `expect(): the check did not hold on the page, so it was not added: ${shortMessage(error)}`,
        };
      }
      const events = context.steps.observe({
        type: "expectPage",
        not: negate,
        expectation: expectation as PageExpectation,
      });
      return {
        ok: true,
        message: `The page ${verdict} ${matcher}.${writtenText(events)}`,
      };
    }

    const located = await context.snapshots.locate(target);
    const label = `${located.ref} (${located.description})`;
    if (located.secret && !isIn(STATE_ONLY, matcher))
      return {
        ok: false,
        error: `expect(): ${label} holds a secret; only its state can be checked (${STATE_ONLY.join(", ")})`,
      };
    try {
      const element = negate
        ? expect(located.locator).not
        : expect(located.locator);
      const check = element as unknown as Check;
      if (isIn(NAMED, matcher)) await check[matcher]!(name, expected, options);
      else if (isIn(PLAIN, matcher)) await check[matcher]!(options);
      else await check[matcher]!(expected, options);
    } catch (error) {
      return {
        ok: false,
        error: `expect(): the check did not hold on ${label}, so it was not added: ${shortMessage(error)}`,
      };
    }
    const events = context.steps.observe({
      type: "expect",
      locator: located.spec,
      not: negate,
      expectation: expectation as Expectation,
    });
    return {
      ok: true,
      message: `${label} ${verdict} ${matcher}.${writtenText(events)}`,
    };
  },
});
