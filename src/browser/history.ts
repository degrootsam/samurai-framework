import logger from "../logger/index.js";
import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { Subscription } from "../transport/subscriptions.js";

/** Time (ms) a history traversal may go without a sign that the entry is shown before it is taken as done */
const HISTORY_SETTLE_TIMEOUT = 1000;

/**
 * Goes one entry back (-1) or forward (1) in the context's history and resolves once the entry is shown. False when
 * there is no such entry.
 */
export async function traverseHistory(
  connector: BiDiConnector,
  context: string,
  delta: -1 | 1,
): Promise<boolean> {
  if (delta === -1 && (await atFirstEntry(connector, context))) return false;
  const settled = await watchHistoryTraversal(connector, context);
  try {
    await connector.send("browsingContext.traverseHistory", {
      context,
      delta,
    });
    // Firefox answers once the entry is shown; Chrome answers before, and a script call in between can hit the
    // document that is going away
    await settled.done;
    return true;
  } catch (err) {
    if (err instanceof BiDiError && err.code === "no such history entry")
      return false;
    throw err;
  } finally {
    await settled.stop();
  }
}

/**
 * Whether going back would only reach the blank page a tab starts with. Firefox does not keep that page in the
 * history, Chrome does; the Navigation API (Chrome only) lets Chrome say the same as Firefox.
 */
async function atFirstEntry(
  connector: BiDiConnector,
  context: string,
): Promise<boolean> {
  try {
    return await callFunction<boolean>(
      connector,
      context,
      `() => {
          const nav = globalThis.navigation;
          if (!nav) return false;
          const entries = nav.entries();
          const index = nav.currentEntry.index;
          return index === 0 || (index === 1 && entries[0].url === "about:blank");
        }`,
      [],
      { awaitPromise: false },
    );
  } catch (err) {
    logger.debug("Could not read the history position", { err });
    return false;
  }
}

/**
 * Starts listening for the end of a history traversal (the new entry committed, or the history or fragment changed
 * within the document). `done` resolves at the first such event, or after a second without one (a page restored from
 * the back-forward cache may say nothing); it never rejects.
 */
async function watchHistoryTraversal(
  connector: BiDiConnector,
  context: string,
): Promise<{
  done: Promise<void>;
  stop(): Promise<void>;
}> {
  const events = [
    "browsingContext.navigationCommitted",
    "browsingContext.historyUpdated",
    "browsingContext.fragmentNavigated",
  ] as const;
  let subscription: Subscription | undefined;
  try {
    subscription = await connector.subscribe([...events]);
  } catch (err) {
    logger.debug("Could not watch a history traversal", { err });
    return { done: Promise.resolve(), stop: async () => {} };
  }
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const timer = setTimeout(finish, HISTORY_SETTLE_TIMEOUT);
  const listener = (info: { context: string }) => {
    if (info.context === context) finish();
  };
  for (const event of events) connector.onEvent(event, listener);
  return {
    done,
    stop: async () => {
      clearTimeout(timer);
      for (const event of events) connector.offEvent(event, listener);
      await subscription?.unsubscribe().catch(() => undefined);
    },
  };
}
