import logger from "../logger/index.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { Info } from "../types/bidi-modules/browsing-context.js";
import { callFunction, ScriptError } from "./call-function.js";

export interface PreloadHandle {
  readonly id: string;
  /** Idempotent. Documents that are already loaded keep the effect until they navigate */
  dispose(): Promise<void>;
}

export interface RunOptions {
  /** A function declaration, e.g. `() => { … }` */
  source: string;
  /** Top-level contexts to cover, including their iframes. Default: every top-level context */
  contexts?: string[];
  /** Named sandbox realm; without it the script runs in the page's own realm */
  sandbox?: string;
  /**
   * What to do when the immediate run in an already-loaded document throws.
   * "log" suits user init scripts (the browser reports such errors for later documents itself)
   * @default "throw"
   */
  onRunError?: "throw" | "log";
}

/**
 * Registers `source` to run before any page script in every future document of `contexts`, and
 * also runs it once in the documents that are loaded now: preload scripts only affect documents
 * created after registration, and callers should not have to care about that ordering.
 */
export async function addPreload(
  connector: BiDiConnector,
  options: RunOptions,
): Promise<PreloadHandle> {
  const { script } = await connector.send("script.addPreloadScript", {
    functionDeclaration: options.source,
    ...(options.contexts && { contexts: options.contexts }),
    ...(options.sandbox !== undefined && { sandbox: options.sandbox }),
  });

  let removed = false;
  const dispose = async () => {
    if (removed) return;
    removed = true;
    try {
      await connector.send("script.removePreloadScript", { script });
    } catch (err) {
      if (err instanceof BiDiError && err.code === "no such script") return;
      throw err;
    }
  };

  try {
    // Registered first, so a document created while this runs is covered by the registration
    await runInLoadedContexts(connector, options);
  } catch (err) {
    await dispose().catch((disposeErr) =>
      logger.debug("Could not remove preload script after a failed run", { disposeErr }),
    );
    throw err;
  }
  return { id: script, dispose };
}

/** Runs `source` once in every loaded context (iframes included) under `contexts` */
export async function runInLoadedContexts(
  connector: BiDiConnector,
  { source, contexts, sandbox, onRunError = "throw" }: RunOptions,
): Promise<void> {
  const trees = contexts
    ? await Promise.all(
        contexts.map((root) => connector.send("browsingContext.getTree", { root })),
      )
    : [await connector.send("browsingContext.getTree", {})];
  const loaded = trees.flatMap((tree) => tree.contexts.flatMap(flatten));

  const outcomes = await Promise.allSettled(
    loaded.map((context) =>
      callFunction(connector, context, source, [], {
        awaitPromise: false,
        ...(sandbox !== undefined && { sandbox }),
      }),
    ),
  );
  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") continue;
    const err: unknown = outcome.reason;
    // The context closed between listing and running: nothing left to cover
    if (err instanceof BiDiError && err.code === "no such frame") continue;
    if (err instanceof ScriptError && onRunError === "log") {
      logger.warn("Script threw while running in a loaded document: %s", err.text);
      continue;
    }
    throw err;
  }
}

function flatten(info: Info): string[] {
  return [info.context, ...(info.children ?? []).flatMap(flatten)];
}
