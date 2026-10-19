import { toFunctionDeclaration } from "../script/call-function.js";

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
