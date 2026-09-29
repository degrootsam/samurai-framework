import { WaitTimeoutError } from "../wait/wait-until.js";

/** A navigation did not end in a loaded page */
export class NavigationError extends Error {
  public readonly url: string;
  public readonly reason: string;
  /** The BiDi error code, or "timeout" */
  public readonly code: string | undefined;

  constructor(url: string, reason: string, code?: string, operation = "navigateTo") {
    super(`${operation}(): ${url} failed: ${reason}`);
    this.name = "NavigationError";
    this.url = url;
    this.reason = reason;
    this.code = code;
  }
}

/** The page did not reach the awaited load state in time */
export class LoadStateTimeoutError extends WaitTimeoutError<undefined> {
  constructor(state: string, timeout: number) {
    super(timeout, undefined);
    this.name = "LoadStateTimeoutError";
    this.message = `waitForLoadState("${state}") did not finish within ${timeout}ms`;
  }
}
