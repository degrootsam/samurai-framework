import type Page from "../../browser/page.js";
import { callFunction } from "../../script/call-function.js";
import type { ElementHandle } from "../../script/element-handle.js";
import { locatorFromSpec } from "../../steps/build.js";
import type { LocatorCall, LocatorSpec } from "../../steps/model.js";
import type { BiDiConnector } from "../../transport/bidi-connection.js";
import { CANDIDATES_JS } from "../candidates.js";
import { expectationFor } from "../normalise.js";
import type { Inspection } from "./controller.js";
import { TOOLBAR_SANDBOX } from "./protocol.js";

/** Most Count choices the Assert panel offers */
const MAX_COUNTS = 3;

/**
 * Run in the toolbar's sandbox on the picked element: its text, value (as the Alt+click rule reads it), first
 * 20 attributes, its role without a name and its `tag.class` selector. `roleOf` only knows the roles the
 * candidates use, so the common list and table roles are added for Count.
 */
const INSPECT_SOURCE = String.raw`(el) => {
  ${CANDIDATES_JS}
  const MORE_ROLES = { li: "listitem", ul: "list", ol: "list", tr: "row", td: "cell", th: "columnheader", option: "option", nav: "navigation", table: "table", article: "article", dialog: "dialog" };
  const tag = el.tagName.toLowerCase();
  const hasValue = typeof el.value === "string" && el.tagName !== "BUTTON" && el.tagName !== "LI";
  const secret = tag === "input" && (el.getAttribute("type") || "").toLowerCase() === "password";
  const classes = Array.from(el.classList).filter(Boolean);
  return {
    text: norm(el.textContent),
    value: hasValue && !secret ? el.value : null,
    attributes: Array.from(el.attributes).slice(0, 20).map((a) => ({ name: a.name, value: a.value })),
    role: roleOf(el) || MORE_ROLES[tag] || null,
    css: classes.length ? CSS.escape(tag) + classes.map((c) => "." + CSS.escape(c)).join("") : null,
  };
}`;

interface Found {
  text: string;
  value: string | null;
  attributes: { name: string; value: string }[];
  role: string | null;
  css: string | null;
}

/** A locator call in short, as the Assert panel shows it: `heading "Sign in"`, `label "Email"`, `li.item` */
export function describeCall(call: LocatorCall): string {
  switch (call.method) {
    case "getByRole":
      return call.name === undefined
        ? call.role
        : `${call.role} "${call.name}"`;
    case "getByLabel":
      return `label "${call.text}"`;
    case "getByText":
      return `text "${call.text}"`;
    case "getByTestId":
      return `test id "${call.testId}"`;
    case "getByCss":
      return call.css;
    case "locator":
      return call.xpath;
  }
}

const sameCall = (a: LocatorCall, b: LocatorCall) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * What the Assert panel needs for a picked element: its short label, text, value, attributes, the first
 * matcher (today's Alt+click rule) and up to three locators that match more than one element, with counts.
 */
export async function inspectElement(
  page: Page,
  connector: BiDiConnector,
  context: string,
  target: ElementHandle,
  locator: LocatorSpec,
  candidates: LocatorCall[],
): Promise<Inspection> {
  const found = await callFunction<Found>(
    connector,
    context,
    INSPECT_SOURCE,
    [target],
    { sandbox: TOOLBAR_SANDBOX },
  );
  const value = found.value ?? undefined;
  const first = expectationFor(found.text, value);

  // The element's role without a name, its tag with its classes, then its other candidates
  const options: LocatorCall[] = [];
  if (found.role) options.push({ method: "getByRole", role: found.role });
  if (found.css) options.push({ method: "getByCss", css: found.css });
  for (const call of candidates)
    if (call.method !== "locator" && !options.some((o) => sameCall(o, call)))
      options.push(call);
  const calls: LocatorCall[] = [];
  const counts: { label: string; count: number }[] = [];
  for (const call of options) {
    if (calls.length >= MAX_COUNTS) break;
    const count = await locatorFromSpec(page, { chain: [call], fallbacks: [] })
      .count()
      .catch(() => 0); // e.g. a role the browser doesn't know
    if (count <= 1) continue;
    calls.push(call);
    counts.push({ label: describeCall(call), count });
  }

  return {
    info: {
      ok: true,
      label: describeCall(locator.chain[0]!),
      text: found.text,
      ...(value !== undefined && { value }),
      attributes: found.attributes,
      first: {
        matcher: first.matcher,
        ...("expected" in first && { expected: String(first.expected) }),
      },
      counts,
    },
    counts: calls,
  };
}
