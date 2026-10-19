import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { Subscription } from "../transport/subscriptions.js";
import type {
  BeforeRequestSentParameters,
  UrlPattern as BiDiUrlPattern,
} from "../types/bidi-modules/network.js";
import { isExactString, type UrlPattern } from "./url-match.js";

/** Whether a browser accepts `urlPatterns` in `network.addIntercept`; asked once per connection */
const patternsUnsupported = new WeakSet<BiDiConnector>();

/**
 * Keeps one browser-side `network.addIntercept` equal to a page's routes: none, one for everything, or one for
 * the exact URLs the routes name. Changes are queued, so two `sync` calls never overlap. Requests the intercept
 * holds are handed to `onBlocked`.
 */
export class Intercept {
  private queue: Promise<unknown> = Promise.resolve();
  private ids = new Set<string>();
  private currentKey: string | undefined;
  private currentId: string | undefined;
  private subscription: Subscription | undefined;

  constructor(
    private connector: BiDiConnector,
    private contextId: string,
    private onBlocked: (params: BeforeRequestSentParameters) => void,
  ) {}

  /** Whether one of `intercepts` is ours: a request held by someone else's intercept is not for us */
  public holds(intercepts: readonly string[] | undefined): boolean {
    return (intercepts ?? []).some((id) => this.ids.has(id));
  }

  /** Makes the browser-side intercept match the routes' patterns, after the changes queued before this one */
  public sync(patterns: readonly UrlPattern[]): Promise<void> {
    const run = this.queue.then(() => this.apply(patterns));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async apply(routePatterns: readonly UrlPattern[]): Promise<void> {
    if (routePatterns.length === 0) return this.stop();

    await this.listen();
    const patterns = this.urlPatterns(routePatterns);
    const key = patterns ? JSON.stringify(patterns) : "all";
    if (key === this.currentKey) return;

    const id = await this.addIntercept(patterns);
    const previous = this.currentId;
    this.currentId = id;
    this.currentKey =
      patterns && !patternsUnsupported.has(this.connector) ? key : "all";
    this.ids.add(id);
    // The new intercept is in place before the old one goes: nothing slips through in between
    if (previous !== undefined) await this.removeIntercept(previous);
  }

  /** The exact URLs to block, or undefined to block everything and match in the router */
  private urlPatterns(
    routePatterns: readonly UrlPattern[],
  ): BiDiUrlPattern[] | undefined {
    if (patternsUnsupported.has(this.connector)) return undefined;
    const patterns: BiDiUrlPattern[] = [];
    for (const pattern of routePatterns) {
      // The browser reads a URL string in normal form; anything else could mean something else to it
      if (!isExactString(pattern) || !isNormalUrl(pattern)) return undefined;
      if (
        !patterns.some(
          (existing) =>
            existing.type === "string" && existing.pattern === pattern,
        )
      ) {
        patterns.push({ type: "string", pattern });
      }
    }
    return patterns;
  }

  private async addIntercept(
    patterns: BiDiUrlPattern[] | undefined,
  ): Promise<string> {
    const params = {
      phases: ["beforeRequestSent" as const],
      contexts: [this.contextId],
    };
    try {
      const { intercept } = await this.connector.send("network.addIntercept", {
        ...params,
        ...(patterns && { urlPatterns: patterns }),
      });
      return intercept;
    } catch (err) {
      if (
        patterns &&
        err instanceof BiDiError &&
        err.code === "invalid argument"
      ) {
        patternsUnsupported.add(this.connector);
        return this.addIntercept(undefined);
      }
      throw err;
    }
  }

  private async removeIntercept(id: string): Promise<void> {
    try {
      await this.connector.send("network.removeIntercept", { intercept: id });
    } catch (err) {
      if (!(err instanceof BiDiError && err.code === "no such intercept"))
        throw err;
    } finally {
      this.ids.delete(id);
    }
  }

  private async listen(): Promise<void> {
    if (this.subscription) return;
    this.connector.onEvent("network.beforeRequestSent", this.onBlocked);
    try {
      this.subscription = await this.connector.subscribe([
        "network.beforeRequestSent",
      ]);
    } catch (err) {
      this.connector.offEvent("network.beforeRequestSent", this.onBlocked);
      throw err;
    }
  }

  private async stop(): Promise<void> {
    const id = this.currentId;
    this.currentId = undefined;
    this.currentKey = undefined;
    if (id !== undefined) await this.removeIntercept(id);
    if (this.subscription) {
      this.connector.offEvent("network.beforeRequestSent", this.onBlocked);
      const subscription = this.subscription;
      this.subscription = undefined;
      await subscription.unsubscribe();
    }
  }
}

function isNormalUrl(value: string): boolean {
  try {
    return new URL(value).href === value;
  } catch {
    return false;
  }
}
