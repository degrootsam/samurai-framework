import { WaitTimeoutError } from "../wait/wait-until.js";
import { matchUrl, type UrlPattern } from "./url-match.js";

/** What `page.waitForRequest` / `waitForResponse` match: a URL pattern, or a function */
export type NetworkMatch<T> = UrlPattern | ((item: T) => boolean);

/** No matching request or response arrived in time; each subclass names itself */
class NetworkWaitTimeoutError extends WaitTimeoutError<undefined> {
  constructor(
    operation: "waitForRequest" | "waitForResponse",
    match: NetworkMatch<never>,
    timeout: number,
  ) {
    super(timeout, undefined);
    this.name = new.target.name;
    const kind = operation === "waitForRequest" ? "request" : "response";
    this.message = `${operation}(): no ${kind} matching ${describeMatch(match)} within ${timeout}ms`;
  }
}

export class RequestTimeoutError extends NetworkWaitTimeoutError {}
export class ResponseTimeoutError extends NetworkWaitTimeoutError {}

/** waitForIdle ran out of time with requests still in flight; `last` holds (up to five of) their URLs */
export class NetworkIdleTimeoutError extends WaitTimeoutError<string[]> {
  constructor(timeout: number, inflight: number, urls: string[]) {
    super(timeout, urls);
    this.name = "NetworkIdleTimeoutError";
    this.message = `waitForNetworkIdle(): still ${inflight} request(s) in flight after ${timeout}ms: ${urls.join(", ")}`;
  }
}

function describeMatch(match: NetworkMatch<never>): string {
  if (typeof match === "function") return "the given function";
  return typeof match === "string" ? JSON.stringify(match) : String(match);
}

/** The predicate for a match: a function as it is, a URL pattern tested on the item's url */
export function toPredicate<T extends { url: string }>(
  match: NetworkMatch<T>,
): (item: T) => boolean {
  return typeof match === "function"
    ? match
    : (item) => matchUrl(match, item.url);
}
