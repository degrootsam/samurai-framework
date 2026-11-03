import { toFunctionDeclaration } from "../script/call-function.js";
import { addPreload, type PreloadHandle } from "../script/preload.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";

/** Wraps an init script as one function declaration; the argument is embedded as JSON because preload scripts take no arguments */
export function initScriptSource(
  script: string | ((arg?: any) => void),
  arg: unknown,
): string {
  if (typeof script === "string") {
    if (arg !== undefined) {
      throw new TypeError(
        "addInitScript(): a string script does not take an argument; pass a function instead",
      );
    }
    return `() => {\n${script}\n}`;
  }
  const declaration = toFunctionDeclaration(script);
  const argument = arg === undefined ? "undefined" : JSON.stringify(arg);
  if (argument === undefined) {
    throw new TypeError(
      "addInitScript(): the argument must be JSON-serializable",
    );
  }
  return `() => (${declaration})(${argument})`;
}

/** The init scripts a page registered, so they can be released with the page */
export class InitScripts {
  private scripts = new Set<PreloadHandle>();

  /** Registers `script` for every document the context loads from now on, and runs it in the one loaded now */
  public async add(
    biDiConnector: BiDiConnector,
    contextId: BrowsingContext,
    script: string | ((arg?: any) => void),
    arg?: unknown,
  ): Promise<PreloadHandle> {
    const source = initScriptSource(script, arg);
    const handle = await addPreload(biDiConnector, {
      source,
      contexts: [contextId],
      onRunError: "log",
    });
    const tracked: PreloadHandle = {
      id: handle.id,
      dispose: async () => {
        this.scripts.delete(tracked);
        await handle.dispose();
      },
    };
    this.scripts.add(tracked);
    return tracked;
  }

  /** The scripts still registered */
  public all(): PreloadHandle[] {
    return [...this.scripts];
  }
}
