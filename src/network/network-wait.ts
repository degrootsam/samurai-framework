import { WaitTimeoutError } from "../wait/wait-until.js";
import { matchUrl, type UrlPattern } from "./url-match.js";

/** What `page.waitForRequest` / `waitForResponse` match: a URL pattern, or a function */
export type NetworkMatch<T> = UrlPattern | ((item: T) => boolean);

/** No matching request or response arrived in time */
export class NetworkWaitTimeoutError extends WaitTimeoutError<undefined> {
  constructor(operation: "waitForRequest" | "waitForResponse", match: NetworkMatch<never>, timeout: number) {
    super(timeout, undefined);
    this.name = operation === "waitForRequest" ? "RequestTimeoutError" : "ResponseTimeoutError";
    const kind = operation === "waitForRequest" ? "request" : "response";
    this.message = `${operation}(): no ${kind} matching ${describeMatch(match)} within ${timeout}ms`;
  }
}

export class RequestTimeoutError extends NetworkWaitTimeoutError {}
export class ResponseTimeoutError extends NetworkWaitTimeoutError {}

function describeMatch(match: NetworkMatch<never>): string {
  if (typeof match === "function") return "the given function";
  return typeof match === "string" ? JSON.stringify(match) : String(match);
}

/** The predicate for a match: a function as it is, a URL pattern tested on the item's url */
export function toPredicate<T extends { url: string }>(match: NetworkMatch<T>): (item: T) => boolean {
  return typeof match === "function" ? match : (item) => matchUrl(match, item.url);
}
