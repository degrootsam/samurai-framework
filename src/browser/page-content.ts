import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";

/** The document as markup: the doctype (when there is one) followed by the document element */
const READ_CONTENT = `() => {
  const type = document.doctype;
  const doctype = type
    ? "<!DOCTYPE " + type.name +
      (type.publicId ? ' PUBLIC "' + type.publicId + '"' : "") +
      (!type.publicId && type.systemId ? " SYSTEM" : "") +
      (type.systemId ? ' "' + type.systemId + '"' : "") + ">"
    : "";
  return doctype + document.documentElement.outerHTML;
}`;

/**
 * Replaces the document in place with `document.open()`, `write()` and `close()`: scripts and styles in `html` run and
 * apply, and the page keeps its URL and origin. The listeners are added after `open()` because it removes the old ones.
 * Resolves true once the `load` (or `DOMContentLoaded`) event fired, false when `timeout` ms passed first.
 */
const WRITE_CONTENT = `async (html, state, timeout) => {
  document.open();
  const reached = new Promise((resolve) => {
    const done = () => resolve(true);
    if (state === "domcontentloaded") document.addEventListener("DOMContentLoaded", done, { once: true });
    else window.addEventListener("load", done, { once: true });
    setTimeout(() => resolve(false), timeout);
  });
  document.write(html);
  document.close();
  return reached;
}`;

/** The page's markup now, with its doctype */
export function readContent(
  connector: BiDiConnector,
  context: string,
): Promise<string> {
  return callFunction<string>(connector, context, READ_CONTENT, [], {
    awaitPromise: false,
  });
}

/** Writes `html` as the page's document; true when the document reached `state` within `timeout` ms */
export function writeContent(
  connector: BiDiConnector,
  context: string,
  html: string,
  state: "load" | "domcontentloaded",
  timeout: number,
): Promise<boolean> {
  return callFunction<boolean>(connector, context, WRITE_CONTENT, [
    html,
    state,
    timeout,
  ]);
}

/** The URL of the document now */
export function readUrl(
  connector: BiDiConnector,
  context: string,
): Promise<string> {
  return callFunction<string>(connector, context, "() => location.href", [], {
    awaitPromise: false,
  });
}

/** The title of the document now */
export function readTitle(
  connector: BiDiConnector,
  context: string,
): Promise<string> {
  return callFunction<string>(connector, context, "() => document.title", [], {
    awaitPromise: false,
  });
}
