import type { ErrorCode } from "../types/bidi-protocols/error.js";

/** A failed BiDi command: an error reply from the browser, or `"timeout"` when none came in time */
export class BiDiError extends Error {
  /** BiDi error code such as "no such node", or "timeout" */
  public readonly code: ErrorCode | "timeout";
  /** The command that failed, e.g. "script.callFunction" */
  public readonly command: string;
  public readonly remoteStack?: string | undefined;

  constructor(
    command: string,
    code: ErrorCode | "timeout",
    message: string,
    remoteStack?: string,
  ) {
    super(`${command} failed (${code}): ${message}`);
    this.name = "BiDiError";
    this.command = command;
    this.code = code;
    this.remoteStack = remoteStack;
  }
}
