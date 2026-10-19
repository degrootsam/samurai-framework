import { BiDiError } from "./bidi-error.js";

/** The browser does not implement a command, a locator type or an option */
export class UnsupportedOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedOperationError";
  }
}

/** Whether the browser answered that it does not know the command: Firefox says "unknown command", others "unsupported operation" */
export function isUnsupported(err: unknown): err is BiDiError {
  return (
    err instanceof BiDiError &&
    (err.code === "unknown command" || err.code === "unsupported operation")
  );
}
