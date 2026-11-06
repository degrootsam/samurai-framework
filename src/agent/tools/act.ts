import { z } from "zod";
import type { Observation } from "../../recorder/normalise.js";
import type { Located } from "../snapshot.js";
import { writtenText } from "../recording.js";
import { defineTool, type ToolContext } from "./context.js";

const KINDS = [
  "click",
  "fill",
  "select",
  "check",
  "uncheck",
  "hover",
  "dblclick",
  "clear",
  "press",
] as const;
type Kind = (typeof KINDS)[number];

/** The kinds that need a `value`, and what it is */
const VALUE_OF: Partial<Record<Kind, string>> = {
  fill: "the text to type",
  select: "the option's value or visible text",
  press: 'the key, for example "Enter" or "Control+A"',
};

const PAST: Record<Kind, string> = {
  click: "Clicked",
  fill: "Filled",
  select: "Selected an option of",
  check: "Checked",
  uncheck: "Unchecked",
  hover: "Hovered",
  dblclick: "Double-clicked",
  clear: "Cleared",
  press: "Pressed a key on",
};

async function perform(
  kind: Kind,
  value: string,
  { locator }: Located,
  timeout: number,
): Promise<void> {
  const options = { timeout };
  switch (kind) {
    case "click":
      return locator.click(options);
    case "fill":
      return locator.fill(value, options);
    case "select":
      await locator.selectOption(value, options);
      return;
    case "check":
      return locator.check(options);
    case "uncheck":
      return locator.uncheck(options);
    case "hover":
      return locator.hover(options);
    case "dblclick":
      return locator.dblclick(options);
    case "clear":
      return locator.clear(options);
    case "press":
      return locator.press(value, options);
  }
}

/** The observation the recorder's normaliser turns into the step for this action */
function observationFor(
  kind: Kind,
  value: string,
  located: Located,
): Observation {
  const { spec: locator, ref: key } = located;
  switch (kind) {
    case "click":
      return { type: "click", key, locator, textEntry: false };
    case "check":
    case "uncheck":
      return {
        type: "click",
        key,
        locator,
        textEntry: false,
        checked: kind === "check",
      };
    case "fill":
      return { type: "input", key, locator, value };
    case "select":
      return { type: "select", key, locator, option: value };
    case "press":
      return { type: "press", key, locator, pressed: value };
    case "hover":
    case "dblclick":
    case "clear":
      return { type: "action", kind, locator };
  }
}

export const act = defineTool({
  name: "act",
  description:
    "Do one thing to an element of the latest snapshot: click, fill (type text), select (an option of a dropdown), " +
    "check, uncheck, hover, dblclick, clear or press (a key). Each success is written to the test as a step; " +
    "a failure writes nothing. Take a new snapshot after the page changes.",
  inputSchema: z.object({
    kind: z.enum(KINDS),
    target: z
      .string()
      .describe("A reference from the latest snapshot, for example e12"),
    value: z
      .string()
      .optional()
      .describe("fill: the text; select: the option; press: the key"),
  }),
  async execute({ kind, target, value }, context: ToolContext) {
    const needs = VALUE_OF[kind];
    if (
      needs !== undefined &&
      (value === undefined || (kind !== "fill" && value === ""))
    )
      return { ok: false, error: `act(): ${kind} needs a value: ${needs}` };
    if (needs === undefined && value !== undefined)
      return { ok: false, error: `act(): ${kind} takes no value` };
    const located = await context.snapshots.locate(target);
    if (kind === "fill" && located.secret)
      return {
        ok: false,
        error: `act(): ${located.ref} (${located.description}) holds a secret; focus it with a click and use useSecret, or ask the person`,
      };
    const text = value ?? "";
    await perform(kind, text, located, context.actionTimeout);
    const events = context.steps.observe(observationFor(kind, text, located));
    return {
      ok: true,
      message: `${PAST[kind]} ${located.ref} (${located.description}).${writtenText(events)}`,
    };
  },
});
