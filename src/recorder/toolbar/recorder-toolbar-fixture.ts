import type Page from "../../browser/page.js";
import { callFunction } from "../../script/call-function.js";
import type { BiDiConnector } from "../../transport/bidi-connection.js";
import { TOOLBAR_KEY, TOOLBAR_SANDBOX, type ToolbarState } from "./protocol.js";

/** The toolbar's hook, as an expression in its sandbox */
export const HOOK = `globalThis[Symbol.for("${TOOLBAR_KEY}")]`;
export const pause = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `probe` until it gives something other than undefined or false */
export async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  what: string,
  ms = 8000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await pause(50);
  }
}

/** Drives the real toolbar in the page `target` gives (read on every call: the page is opened in `before`) */
export function toolbarDriver(
  target: () => { page: Page; connector: BiDiConnector },
) {
  const inSandbox = <T>(fn: string, ...args: unknown[]) => {
    const { page, connector } = target();
    return callFunction<T>(connector, page.contextId, fn, args as never[], {
      sandbox: TOOLBAR_SANDBOX,
    });
  };
  return {
    inSandbox,
    press: (action: string, detail?: object) =>
      inSandbox(
        `(action, detail) => { ${HOOK}.press(action, detail); }`,
        action,
        detail,
      ),
    /** Runs the picker's click on the first element matching `selector` */
    pickElement: (selector: string) =>
      inSandbox(
        `(selector) => { ${HOOK}.press("pick", { target: document.querySelector(selector) }); }`,
        selector,
      ),
    viewState: () =>
      inSandbox<ToolbarState | null>(`() => ${HOOK} ? ${HOOK}.state() : null`),
    /** Sets a toolbar form input as typing into it would */
    typeInto: (field: string, value: string) =>
      inSandbox(
        `(field, value) => {
      const el = ${HOOK}.root.querySelector('[data-field="' + field + '"]');
      if (!el) throw new Error("no field " + field);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }`,
        field,
        value,
      ),
  };
}
