import { BiDiError } from "../transport/bidi-error.js";
import { callFunction, type PageFunction } from "../script/call-function.js";
import { ATTACHED_ONLY } from "./page-scripts.js";
import type { ElementAccess } from "./element-access.js";

/**
 * Waits until the element is attached (hidden is fine), then calls `fn(element, arg)` in the page.
 * A missing element ends in the usual timeout error; a strict locator throws when several match.
 * What the page function throws reaches the caller unchanged (a `ScriptError`).
 */
export async function evaluateOnElement<R, A>(
  access: ElementAccess,
  fn: PageFunction<[any, A], R>,
  arg: A | undefined,
  options?: { timeout?: number },
): Promise<R> {
  await access.waitForActionable(
    "evaluate",
    ATTACHED_ONLY,
    { scroll: false, hitTest: false },
    options?.timeout === undefined ? undefined : { timeout: options.timeout },
  );
  const el = await access.requireElement();
  try {
    return await callFunction<R>(
      access.connector,
      access.contextId,
      fn,
      arg === undefined ? [el] : [el, arg],
    );
  } catch (err) {
    // The element went away between the search and the call
    if (err instanceof BiDiError && err.code === "no such node")
      throw access.noElementError();
    throw err;
  }
}

/** Calls `fn(elements, arg)` in the page with every element the locator matches now (an empty array when none); does not wait */
export async function evaluateOnAll<R, A>(
  access: ElementAccess,
  fn: PageFunction<[any[], A], R>,
  arg: A | undefined,
): Promise<R> {
  // One more search when an element was removed between the search and the call
  for (let attempt = 1; ; attempt++) {
    const elements = await access.resolveAll();
    try {
      return await callFunction<R>(
        access.connector,
        access.contextId,
        fn,
        arg === undefined ? [elements] : [elements, arg],
      );
    } catch (err) {
      if (
        attempt === 2 ||
        !(err instanceof BiDiError && err.code === "no such node")
      )
        throw err;
    }
  }
}
