import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { Subscription } from "../transport/subscriptions.js";
import type { BrowsingContext, Info } from "../types/bidi-modules/browsing-context.js";

/**
 * Tracks which browsing contexts (iframes) belong to which top-level context, so events that
 * carry a child context id can be attributed to the page that owns it.
 * Destroyed contexts stay known: late events for them must still resolve to their page.
 */
export class ContextTree {
  private parents = new Map<BrowsingContext, BrowsingContext | null>();

  private constructor(
    private connector: BiDiConnector,
    private subscription: Subscription,
  ) {}

  public static async create(connector: BiDiConnector): Promise<ContextTree> {
    // Subscribe first: a context created between getTree and subscribing would be missed
    const subscription = await connector.subscribe([
      "browsingContext.contextCreated",
      "browsingContext.contextDestroyed",
    ]);
    const tree = new ContextTree(connector, subscription);
    connector.onEvent("browsingContext.contextCreated", tree.onContext);
    connector.onEvent("browsingContext.contextDestroyed", tree.onContext);
    try {
      const { contexts } = await connector.send("browsingContext.getTree", {});
      contexts.forEach((info) => tree.add(info));
    } catch (err) {
      await tree.dispose();
      throw err;
    }
    return tree;
  }

  private onContext = (info: Info) => this.add(info);

  private add(info: Info) {
    this.parents.set(info.context, info.parent ?? null);
    info.children?.forEach((child) => this.add(child));
  }

  /** The direct parent, or null for a top-level or unknown context */
  public parentOf(context: BrowsingContext): BrowsingContext | null {
    return this.parents.get(context) ?? null;
  }

  /** The top-level context that contains `context`; an unknown context is its own root */
  public rootOf(context: BrowsingContext): BrowsingContext {
    let current = context;
    for (let parent = this.parentOf(current); parent !== null; parent = this.parentOf(current)) {
      current = parent;
    }
    return current;
  }

  /** True when `context` is `root` or one of its descendants; false for unknown contexts */
  public isWithin(context: BrowsingContext, root: BrowsingContext): boolean {
    if (context === root) return true;
    return this.parents.has(context) && this.rootOf(context) === root;
  }

  public async dispose(): Promise<void> {
    this.connector.offEvent("browsingContext.contextCreated", this.onContext);
    this.connector.offEvent("browsingContext.contextDestroyed", this.onContext);
    this.parents.clear();
    await this.subscription.unsubscribe();
  }
}
