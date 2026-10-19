import type EventEmitter from "node:events";
import type {
  FailedRequest,
  NetworkRequest,
} from "../network/network-tracker.js";
import type { Response } from "../network/response.js";
import type { ConsoleMessage, PageError } from "./page-logs.js";
import type { Dialog } from "./dialog.js";
import type { Download } from "./download.js";
import type { FileChooser } from "./file-chooser.js";

export interface NetworkEvents {
  request: [NetworkRequest];
  response: [Response];
  requestfailed: [FailedRequest];
}

/** Everything `page.on` can listen for */
export interface PageEvents extends NetworkEvents {
  download: [Download];
  filechooser: [FileChooser];
  dialog: [Dialog];
  console: [ConsoleMessage];
  pageerror: [PageError];
}
export type PageEventName = keyof PageEvents;

/** Events `page.waitForEvent` can wait for */
export type WaitableEventName =
  "download" | "filechooser" | "request" | "response";

/** What the `waitFor…` calls of a page take */
export interface WaitOptions {
  /** Time (ms) to wait. @default config `navigation.timeout`, then 30000 */
  timeout?: number;
  /** Runs once the wait is set up; what it causes cannot be missed */
  trigger?: () => Promise<unknown>;
}

export interface WaitForEventOptions<T> extends WaitOptions {
  /** Only an event this accepts counts */
  predicate?: (item: T) => boolean;
}

/** What has to be switched on in the browser before an event can arrive */
export type EventSource =
  "dialogs" | "downloads" | "filechoosers" | "logs" | "network" | "bodies";

/** The parts of the page that must be listening for `event` to happen (a `response` also needs the bodies) */
export function sourcesFor(event: PageEventName): EventSource[] {
  switch (event) {
    case "dialog":
      return ["dialogs"];
    case "download":
      return ["downloads"];
    case "filechooser":
      return ["filechoosers"];
    case "console":
    case "pageerror":
      return ["logs"];
    case "response":
      return ["network", "bodies"];
    default:
      return ["network"];
  }
}

/**
 * Resolves with the first `event` that `matches` accepts. Listens before `options.trigger` runs, so what the trigger
 * causes cannot be missed; a trigger that throws rejects the wait with its error. `onTimeout` builds the error for a
 * wait that ran out after `timeout` ms.
 */
export function waitForPageEvent<E extends PageEventName>(
  emitter: EventEmitter,
  event: E,
  matches: (item: PageEvents[E][0]) => boolean,
  options: Pick<WaitOptions, "trigger">,
  timeout: number,
  onTimeout: (timeout: number) => Error,
): Promise<PageEvents[E][0]> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      emitter.off(event, listener);
    };
    const listener = (item: PageEvents[E][0]) => {
      try {
        if (!matches(item)) return;
      } catch (err) {
        done();
        reject(err);
        return;
      }
      done();
      resolve(item);
    };
    const timer = setTimeout(() => {
      done();
      reject(onTimeout(timeout));
    }, timeout);
    emitter.on(event, listener as (...args: unknown[]) => void);
    const { trigger } = options;
    if (trigger) {
      Promise.resolve()
        .then(trigger)
        .catch((err) => {
          done();
          reject(err);
        });
    }
  });
}
