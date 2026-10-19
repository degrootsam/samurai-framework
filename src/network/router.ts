import type { ContextTree } from "../browser/context-tree.js";
import logger from "../logger/index.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BeforeRequestSentParameters } from "../types/bidi-modules/network.js";
import { toRequest } from "./bidi-wire.js";
import { Intercept } from "./intercept.js";
import type { NetworkRequest } from "./network-types.js";
import {
  PendingRoute,
  type PendingRouteControl,
  type RouteEntry,
  type RouteHandler,
} from "./route.js";
import { matchUrl, samePattern, type UrlPattern } from "./url-match.js";

export type { RouteHandler } from "./route.js";
export { Route } from "./route.js";

/** Time (ms) a handler may take to answer a request before the router lets it continue */
const DEFAULT_ROUTE_TIMEOUT = 30000;
/** How many handler errors the router keeps */
const MAX_ERRORS = 100;

/**
 * Lets a page mock, block and change requests. One `network.addIntercept` serves all routes; matching
 * happens here. Every request the browser holds is answered exactly once, so nothing hangs.
 */
export class Router {
  private routes: RouteEntry[] = [];
  private pending = new Set<PendingRoute>();
  private failures: Error[] = [];
  private intercept: Intercept;
  private disposed = false;
  private routeTimeout: number;

  constructor(
    private connector: BiDiConnector,
    private tree: ContextTree,
    private contextId: string,
    options: { routeTimeout?: number } = {},
  ) {
    this.routeTimeout = options.routeTimeout ?? DEFAULT_ROUTE_TIMEOUT;
    this.intercept = new Intercept(
      connector,
      contextId,
      this.onBeforeRequestSent,
    );
  }

  /** Errors thrown by route handlers, oldest first */
  public get errors(): readonly Error[] {
    return [...this.failures];
  }

  /** Sends matching requests to `handler`. Later routes are asked first */
  public async route(
    pattern: UrlPattern,
    handler: RouteHandler,
  ): Promise<void> {
    if (this.disposed) throw new Error("router disposed");
    const entry: RouteEntry = { pattern, handler };
    this.routes.push(entry);
    try {
      await this.syncIntercept();
    } catch (err) {
      this.routes = this.routes.filter((route) => route !== entry);
      throw err;
    }
  }

  /** Removes the routes for `pattern` (only the one with `handler`, when given) */
  public async unroute(
    pattern: UrlPattern,
    handler?: RouteHandler,
  ): Promise<void> {
    const removed = this.routes.filter(
      (route) =>
        samePattern(route.pattern, pattern) &&
        (handler === undefined || route.handler === handler),
    );
    await this.remove(removed);
  }

  public async unrouteAll(): Promise<void> {
    await this.remove([...this.routes]);
  }

  /** Lets held requests continue, removes the intercept and stops listening. Idempotent */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.remove([...this.routes]);
  }

  private async remove(removed: RouteEntry[]) {
    if (removed.length === 0) return;
    this.routes = this.routes.filter((route) => !removed.includes(route));
    // Requests a removed route still holds would wait for nobody
    await Promise.all(
      [...this.pending]
        .filter((route) => route.entry && removed.includes(route.entry))
        .map((route) => route.release()),
    );
    await this.syncIntercept();
  }

  /** Makes the browser-side intercept match the routes */
  private syncIntercept(): Promise<void> {
    return this.intercept.sync(this.routes.map((route) => route.pattern));
  }

  private onBeforeRequestSent = (params: BeforeRequestSentParameters) => {
    if (!params.isBlocked || params.context === null) return;
    if (!this.tree.isWithin(params.context, this.contextId)) return;
    // Held by an intercept of ours, not someone else's
    if (!this.intercept.holds(params.intercepts)) return;

    const info = toRequest(
      params.request,
      params.navigation,
      params.isBlocked,
      null,
    );
    const matching = this.routes
      .filter((entry) => matchUrl(entry.pattern, info.url))
      .reverse();
    this.dispatch(info, matching, 0).catch((err) =>
      logger.error("Handling the request to %s failed", info.url, { err }),
    );
  };

  /** Runs the `index`-th matching route; past the last one the request continues unchanged */
  private async dispatch(
    info: NetworkRequest,
    matching: RouteEntry[],
    index: number,
  ): Promise<void> {
    const entry = matching[index];
    const control: PendingRouteControl = {
      send: (method, params) => this.connector.send(method, params),
      next: () => this.dispatch(info, matching, index + 1),
      onSettled: (settled) => {
        this.pending.delete(settled);
      },
      sendsContentLength: this.connector.browserName !== "chrome",
    };
    if (!entry) {
      // Nobody (left) to ask: an unmatched request, or every route fell back
      await new PendingRoute(info, control).release();
      return;
    }

    const pending = new PendingRoute(info, control, entry);
    this.pending.add(pending);
    pending.startTimer(this.routeTimeout, () => {
      logger.error(
        "A route for %s did not answer within %dms; letting the request continue",
        info.url,
        this.routeTimeout,
      );
      void pending.release();
    });

    try {
      await entry.handler(pending.route);
    } catch (err) {
      this.record(info, err);
      await pending.failQuietly();
      return;
    }
    if (!pending.isAnswered) {
      logger.warn(
        "The route for %s did not answer the request; letting it continue",
        info.url,
      );
      await pending.release();
    }
  }

  private record(info: NetworkRequest, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const error = Object.assign(
      new Error(`route handler for ${info.url} threw: ${message}`),
      { cause: err },
    );
    this.failures.push(error);
    if (this.failures.length > MAX_ERRORS) this.failures.shift();
    logger.error("A route handler threw for %s", info.url, { err });
  }
}
