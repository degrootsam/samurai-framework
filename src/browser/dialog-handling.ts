import type EventEmitter from "node:events";
import logger from "../logger/index.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { Subscription } from "../transport/subscriptions.js";
import type {
  BrowsingContext,
  UserPromptClosedParameters,
  UserPromptOpenedParameters,
} from "../types/bidi-modules/browsing-context.js";
import type { ContextTree } from "./context-tree.js";
import { Dialog } from "./dialog.js";
import { Lazy } from "./lazy.js";

/** The context tree of a page: created on first use, readable once it exists */
export interface TreeSource {
  ensure(): Promise<ContextTree>;
  peek(): ContextTree | undefined;
}

/**
 * Watches the JavaScript dialogs of one page (frames included) and hands each to the `dialog` listeners of
 * `emitter`; a dialog nobody answers gets the default answer, so nothing hangs.
 */
export class DialogHandling {
  private lazySubscription = new Lazy<Subscription>();
  private openDialogs = new Map<string, Dialog>();

  constructor(
    private connector: BiDiConnector,
    private contextId: BrowsingContext,
    private tree: TreeSource,
    private emitter: EventEmitter,
  ) {}

  /** Starts watching for dialogs; the browser does this when it opens a page, `page.on("dialog")` when needed */
  public async start(): Promise<void> {
    await this.lazySubscription.get(async () => {
      await this.tree.ensure();
      this.connector.onEvent(
        "browsingContext.userPromptOpened",
        this.onPromptOpened,
      );
      this.connector.onEvent(
        "browsingContext.userPromptClosed",
        this.onPromptClosed,
      );
      try {
        return await this.connector.subscribe([
          "browsingContext.userPromptOpened",
          "browsingContext.userPromptClosed",
        ]);
      } catch (err) {
        this.stopListening();
        throw err;
      }
    });
  }

  /** Stops listening, forgets the open dialogs and gives the subscription back */
  public async dispose(): Promise<void> {
    const subscription = this.lazySubscription.take();
    this.stopListening();
    this.openDialogs.clear();
    await (await subscription)?.unsubscribe();
  }

  private stopListening(): void {
    this.connector.offEvent(
      "browsingContext.userPromptOpened",
      this.onPromptOpened,
    );
    this.connector.offEvent(
      "browsingContext.userPromptClosed",
      this.onPromptClosed,
    );
  }

  private ownsContext(context: string): boolean {
    return (
      this.tree.peek()?.isWithin(context, this.contextId) ??
      context === this.contextId
    );
  }

  private onPromptOpened = (params: UserPromptOpenedParameters) => {
    if (!this.ownsContext(params.context)) return;
    this.dispatchDialog(
      new Dialog(this.connector, this.contextId, params),
      params,
    ).catch((err) => logger.error("Handling a dialog failed", { err }));
  };

  private onPromptClosed = (params: UserPromptClosedParameters) => {
    if (!this.ownsContext(params.context)) return;
    const dialog = this.openDialogs.get(params.context);
    this.openDialogs.delete(params.context);
    dialog?.markClosed({
      accepted: params.accepted,
      ...(params.userText !== undefined && { userText: params.userText }),
    });
  };

  /** Lets the listeners answer; a dialog still open afterwards gets the default answer, so nothing hangs */
  private async dispatchDialog(
    dialog: Dialog,
    params: UserPromptOpenedParameters,
  ) {
    this.openDialogs.set(params.context, dialog);
    // rawListeners: the wrappers that make a `once` listener remove itself when called
    const listeners = this.emitter.rawListeners("dialog") as Array<
      (dialog: Dialog) => unknown
    >;
    await Promise.all(
      listeners.map(async (listener) => {
        try {
          await listener(dialog);
        } catch (err) {
          logger.error("A dialog listener threw", { err });
        }
      }),
    );
    if (dialog.handled) return;
    // Staying on a page is not what a test that navigates wants: leave it, dismiss everything else
    const accept = params.type === "beforeunload";
    logger.warn(
      'Dialog "%s" was %s automatically; add page.on("dialog") to handle it',
      params.message,
      accept ? "accepted" : "dismissed",
    );
    await (accept ? dialog.accept() : dialog.dismiss());
  }
}
