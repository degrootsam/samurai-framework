import { BiDiError } from "../transport/bidi-error.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";
import type { ElementHandle } from "../script/element-handle.js";
import type { Arg } from "../script/serialize.js";
import {
  isGeneratedFile,
  resolveFileInputs,
  type FileInput,
} from "../browser/generated-files.js";
import type { CheckName, ProbeOptions } from "./element-state.js";
import type { ActionOptions } from "./actionability.js";
import {
  DROP_CHECKS,
  DROP_EVENTS,
  DROP_INPUT,
  DROP_SANDBOX,
  FILE_INPUT_CHECKS,
  FILE_INPUT_INFO,
} from "./page-scripts.js";

/** What the file actions need of a locator */
export interface ElementContext {
  readonly connector: BiDiConnector;
  readonly contextId: BrowsingContext;
  /** The locator's description for error messages */
  readonly selector: string;
  call<T>(fn: string, args: Arg[], sandbox?: string): Promise<T>;
  waitForActionable(
    action: string,
    checks: readonly CheckName[],
    probe: ProbeOptions,
    options: ActionOptions | undefined,
  ): Promise<unknown>;
  /** The element the locator matches now; throws when none does */
  requireElement(): Promise<ElementHandle>;
  /** The error for an operation that needs an element when none matches */
  noElementError(): Error;
}

/**
 * Sets the files of an `<input type=file>`; `[]` clears it. Waits for the input to be attached and enabled;
 * it need not be visible, file inputs are often hidden behind a label.
 */
export async function setInputFiles(
  ctx: ElementContext,
  files: FileInput | FileInput[],
  options?: { timeout?: number },
): Promise<void> {
  const paths = await resolveFileInputs(files, "setInputFiles");

  await ctx.waitForActionable(
    "setInputFiles",
    FILE_INPUT_CHECKS,
    { scroll: false, hitTest: false },
    options,
  );

  const el = await ctx.requireElement();
  let info: { tag: string; type: string; multiple: boolean };
  try {
    info = await ctx.call(FILE_INPUT_INFO, [el]);
  } catch (err) {
    if (err instanceof BiDiError && err.code === "no such node")
      throw ctx.noElementError();
    throw err;
  }

  if (info.tag !== "input" || info.type !== "file") {
    const found =
      info.tag === "input"
        ? `<input type="${info.type || "text"}">`
        : `<${info.tag}>`;
    throw new Error(
      `setInputFiles(): ${ctx.selector} is not an <input type=file> (found ${found})`,
    );
  }
  if (paths.length > 1 && !info.multiple) {
    throw new Error(
      `setInputFiles(): ${ctx.selector} does not accept multiple files`,
    );
  }

  await ctx.connector.send("input.setFiles", {
    context: ctx.contextId,
    element: { sharedId: el.sharedId },
    files: paths,
  });
}

/**
 * Drops files on the element, as dragging them from the desktop does: `dragenter`, `dragover` and `drop`
 * with a `DataTransfer` holding the files. The events are synthetic (`isTrusted` is false).
 * Waits for the element to be attached and visible.
 */
export async function dropFiles(
  ctx: ElementContext,
  files: FileInput | FileInput[],
  options?: { timeout?: number },
): Promise<void> {
  const list = Array.isArray(files) ? files : [files];
  const paths = await resolveFileInputs(list, "dropFiles");
  const types = list.map((file) =>
    isGeneratedFile(file) ? (file.type ?? "") : "",
  );
  await ctx.waitForActionable(
    "dropFiles",
    DROP_CHECKS,
    { scroll: true, hitTest: false },
    options,
  );
  const el = await ctx.requireElement();
  // A file input of our own, made in a sandbox and never attached: the page doesn't see it
  const input = await ctx.call<ElementHandle>(DROP_INPUT, [], DROP_SANDBOX);
  await ctx.connector.send("input.setFiles", {
    context: ctx.contextId,
    element: { sharedId: input.sharedId },
    files: paths,
  });
  await ctx.call(DROP_EVENTS, [el, types], DROP_SANDBOX);
}
