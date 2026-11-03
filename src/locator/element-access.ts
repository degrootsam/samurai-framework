import { BiDiError } from "../transport/bidi-error.js";
import { callFunction, ScriptError } from "../script/call-function.js";
import type { ElementHandle } from "../script/element-handle.js";
import type { Arg } from "../script/serialize.js";
import type { ElementContext } from "./file-actions.js";

/** What reads and actions need of a locator: its page, its description, and finding its element */
export interface ElementAccess extends ElementContext {
  /**
   * The element the locator matches first. With a `method` name and strict selectors on, several matches
   * throw instead (`method` is the public method that asked, for the message)
   */
  resolveOne(method?: string): Promise<ElementHandle | null>;
  /** Every element the locator matches now, in document order; never strict, never waits */
  resolveAll(): Promise<ElementHandle[]>;
}

/** Calls `fn` in the page; a throwing function becomes a "Failed to locate element" error */
export async function callInPage<T>(
  access: Pick<ElementAccess, "connector" | "contextId" | "selector">,
  fn: string,
  args: Arg[],
  sandbox?: string,
): Promise<T> {
  try {
    return await callFunction<T>(access.connector, access.contextId, fn, args, {
      awaitPromise: false,
      ...(sandbox !== undefined && { sandbox }),
    });
  } catch (err) {
    if (err instanceof ScriptError) {
      throw new Error(
        `Failed to locate element ${access.selector}. Details: ${err.text}`,
      );
    }
    throw err;
  }
}

/**
 * Calls a function on the first matching element: `body` sees it as `el`, followed by `params`.
 * Answers `whenMissing` when nothing matches, or the element disappeared meanwhile.
 */
export async function callOnElement<T>(
  access: ElementAccess,
  whenMissing: T,
  body: string,
  params: string[] = [],
  args: Arg[] = [],
  method?: string,
): Promise<T> {
  const el = await access.resolveOne(method);
  if (!el) return whenMissing;
  try {
    return await access.call<T>(
      `(el${params.map((param) => `, ${param}`).join("")}) => { ${body} }`,
      [el, ...args],
    );
  } catch (err) {
    if (err instanceof BiDiError && err.code === "no such node")
      return whenMissing;
    throw err;
  }
}

/** Like `callOnElement`, for operations that cannot go on without the element */
export async function callOnExistingElement<T>(
  access: ElementAccess,
  body: string,
  method?: string,
): Promise<T> {
  const missing = Symbol("missing");
  const result = await callOnElement<T | typeof missing>(
    access,
    missing,
    body,
    [],
    [],
    method,
  );
  if (result === missing) throw noElementError(access.selector);
  return result;
}

/** The error for an operation that needs an element when none matches */
export function noElementError(selector: string): Error {
  return new Error(
    `Failed to locate element ${selector}. Details: no element matches`,
  );
}

/** The element the locator matches now; throws when none does */
export async function requireElement(
  access: ElementAccess,
): Promise<ElementHandle> {
  const el = await access.resolveOne();
  if (!el) throw noElementError(access.selector);
  return el;
}
