import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { Subscription } from "../transport/subscriptions.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";
import { Lazy } from "./lazy.js";
import { NavigationError } from "./navigation-error.js";

/** How many navigations keep their load progress */
const NAVIGATIONS_REMEMBERED = 20;

/** What a wait for the document can reach */
export type DocumentState = "load" | "domcontentloaded";

/** Events a connection's browser rejected as unknown, so nothing asks for them again */
const unsupportedEventsByConnector = new WeakMap<BiDiConnector, Set<string>>();

function unsupportedEvents(connector: BiDiConnector): Set<string> {
  let events = unsupportedEventsByConnector.get(connector);
  if (!events)
    unsupportedEventsByConnector.set(connector, (events = new Set()));
  return events;
}

/** A wait ends with the navigation it was waiting for failing or being aborted */
function navigationFailure(url: string, what: string): never {
  throw new NavigationError(url, what, undefined, "waitForLoadState");
}

/**
 * Follows the document of one page: which navigations reached DOMContentLoaded and load, and waits for a state of
 * the document that is showing (or of the navigation that is on its way).
 */
export class DocumentWatcher {
  /** How far navigations that did not wait for the load got, by navigation id (the latest few) */
  private navigationProgress = new Map<
    string,
    { domContentLoaded: boolean; load: boolean }
  >();
  private lazyEvents = new Lazy<Subscription>();

  constructor(
    private connector: BiDiConnector,
    private contextId: BrowsingContext,
  ) {}

  /** The progress of `navigation`, created (and the oldest forgotten) when it is not known yet */
  public progressOf(navigation: string) {
    let progress = this.navigationProgress.get(navigation);
    if (!progress) {
      progress = { domContentLoaded: false, load: false };
      this.navigationProgress.set(navigation, progress);
      // Only the latest few navigations matter
      if (this.navigationProgress.size > NAVIGATIONS_REMEMBERED) {
        this.navigationProgress.delete(
          this.navigationProgress.keys().next().value as string,
        );
      }
    }
    return progress;
  }

  private onDocumentEvent =
    (kind: "domContentLoaded" | "load") =>
    (info: { context: string; navigation: string | null }) => {
      if (info.context !== this.contextId || info.navigation === null) return;
      const progress = this.progressOf(info.navigation);
      progress.domContentLoaded = true;
      if (kind === "load") progress.load = true;
    };
  private onDomContentLoaded = this.onDocumentEvent("domContentLoaded");
  private onLoad = this.onDocumentEvent("load");

  /** Starts recording which navigations reached DOMContentLoaded and load; kept until dispose */
  public watch(): Promise<Subscription> {
    return this.lazyEvents.get(async () => {
      this.connector.onEvent(
        "browsingContext.domContentLoaded",
        this.onDomContentLoaded,
      );
      this.connector.onEvent("browsingContext.load", this.onLoad);
      try {
        return await this.connector.subscribe([
          "browsingContext.domContentLoaded",
          "browsingContext.load",
        ]);
      } catch (err) {
        this.connector.offEvent(
          "browsingContext.domContentLoaded",
          this.onDomContentLoaded,
        );
        this.connector.offEvent("browsingContext.load", this.onLoad);
        throw err;
      }
    });
  }

  /** Stops listening and gives the subscription back */
  public async dispose(): Promise<void> {
    const subscription = this.lazyEvents.take();
    this.connector.offEvent(
      "browsingContext.domContentLoaded",
      this.onDomContentLoaded,
    );
    this.connector.offEvent("browsingContext.load", this.onLoad);
    await (await subscription)?.unsubscribe();
  }

  private canBeAborted(): boolean {
    return !unsupportedEvents(this.connector).has(
      "browsingContext.navigationAborted",
    );
  }

  /** Subscribes to what a wait listens for; a browser that lacks the navigationAborted event (Firefox) is asked only once */
  private async subscribe(
    reachedEvent: "browsingContext.load" | "browsingContext.domContentLoaded",
  ) {
    const required = [
      reachedEvent,
      "browsingContext.navigationFailed",
    ] as const;
    if (!this.canBeAborted()) return this.connector.subscribe([...required]);
    try {
      return await this.connector.subscribe([
        ...required,
        "browsingContext.navigationAborted",
      ]);
    } catch (err) {
      if (!(err instanceof BiDiError) || err.code !== "invalid argument")
        throw err;
      unsupportedEvents(this.connector).add(
        "browsingContext.navigationAborted",
      );
      return this.connector.subscribe([...required]);
    }
  }

  /**
   * The first of: the state is reached, the navigation `last` fails, the navigation `last` is aborted. Registered
   * before the state is read, so an event in between is not lost.
   */
  private eventsOf(
    reachedEvent: "browsingContext.load" | "browsingContext.domContentLoaded",
    last: string | undefined,
    listen: { timeout: number; signal: AbortSignal },
  ): Promise<unknown> {
    const connector = this.connector;
    return Promise.race([
      connector.waitForEvent(
        reachedEvent,
        (p) => p.context === this.contextId,
        listen,
      ),
      connector
        .waitForEvent(
          "browsingContext.navigationFailed",
          (p) =>
            p.context === this.contextId &&
            (last === undefined || p.navigation === last),
          listen,
        )
        .then((p) => navigationFailure(p.url, "navigation failed")),
      ...(this.canBeAborted()
        ? [
            connector
              .waitForEvent(
                "browsingContext.navigationAborted",
                (p) =>
                  p.context === this.contextId &&
                  last !== undefined &&
                  p.navigation === last,
                listen,
              )
              .then((p) => navigationFailure(p.url, "navigation aborted")),
          ]
        : []),
    ]);
  }

  /** Whether the document is at `target` already: a navigation we saw fall short beats the document that is showing */
  private async readyStateReached(
    target: DocumentState,
    last: string | undefined,
  ): Promise<boolean> {
    const known =
      last === undefined ? undefined : this.navigationProgress.get(last);
    if (known && !(target === "load" ? known.load : known.domContentLoaded))
      return false;
    const readyState = await callFunction<string>(
      this.connector,
      this.contextId,
      "() => document.readyState",
      [],
      { awaitPromise: false },
    );
    return target === "load"
      ? readyState === "complete"
      : readyState === "interactive" || readyState === "complete";
  }

  /**
   * Resolves when the document reached `target`; rejects with a NavigationError when the navigation `last` (the
   * latest one navigateTo started) fails or is aborted, and with a WaitTimeoutError after `timeout` ms.
   */
  public async waitForState(
    target: DocumentState,
    timeout: number,
    last: string | undefined,
  ): Promise<void> {
    const reachedEvent =
      target === "load"
        ? "browsingContext.load"
        : "browsingContext.domContentLoaded";
    const subscription = await this.subscribe(reachedEvent);
    const abort = new AbortController();
    try {
      const events = this.eventsOf(reachedEvent, last, {
        timeout,
        signal: abort.signal,
      });
      events.catch(() => {}); // settled below, or aborted in finally
      if (!(await this.readyStateReached(target, last))) await events;
    } finally {
      abort.abort();
      await subscription.unsubscribe();
    }
  }
}
