import EventEmitter from "node:events";
import logger from "../logger/index.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { Subscription } from "../transport/subscriptions.js";
import type {
  DownloadEndParams,
  DownloadWillBeginParams,
} from "../types/bidi-modules/browsing-context.js";
import { WaitTimeoutError } from "../wait/wait-until.js";
import type { ContextTree } from "./context-tree.js";

/** A download did not complete */
export class DownloadError extends Error {
  public readonly url: string;
  /** "canceled": the browser stopped it or the server broke the connection; "page closed" */
  public readonly reason: string;

  constructor(url: string, reason: string) {
    super(`Download of ${url} failed: ${reason}`);
    this.name = "DownloadError";
    this.url = url;
    this.reason = reason;
  }
}

/** A download did not finish in time */
export class DownloadTimeoutError extends WaitTimeoutError<undefined> {
  constructor(url: string, timeout: number) {
    super(timeout, undefined);
    this.name = "DownloadTimeoutError";
    this.message = `Download of ${url} did not finish within ${timeout}ms`;
  }
}

type Outcome = { status: "complete"; path: string } | { status: "canceled" } | { status: "closed" };

/** A file the page started to download */
export class Download {
  private settle!: (outcome: Outcome) => void;
  private outcome = new Promise<Outcome>((resolve) => (this.settle = resolve));

  constructor(
    private readonly address: string,
    private readonly filename: string,
    private readonly defaultTimeout: number,
  ) {}

  public url(): string {
    return this.address;
  }

  /** The name the server (or the link) suggested */
  public suggestedFilename(): string {
    return this.filename;
  }

  /**
   * Waits until the download finished and returns where the browser saved it. Rejects with DownloadError when it was
   * cancelled, and with DownloadTimeoutError after `timeout` ms (default: the navigation timeout).
   */
  public async path(options: { timeout?: number } = {}): Promise<string> {
    const timeout = options.timeout ?? this.defaultTimeout;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DownloadTimeoutError(this.address, timeout)), timeout);
    });
    try {
      const outcome = await Promise.race([this.outcome, late]);
      if (outcome.status === "complete") return outcome.path;
      throw new DownloadError(this.address, outcome.status === "closed" ? "page closed" : "canceled");
    } finally {
      clearTimeout(timer);
    }
  }

  /** Waits for the end of the download: null when it completed, otherwise why it did not ("canceled") */
  public async failure(): Promise<string | null> {
    const outcome = await this.outcome;
    if (outcome.status === "complete") return null;
    return outcome.status === "closed" ? "page closed" : "canceled";
  }

  /** @internal */
  public finish(outcome: Outcome): void {
    this.settle(outcome);
  }
}

interface EventMap {
  download: [Download];
}

/** Follows the downloads of one page (frames included) */
export class DownloadTracker {
  private events = new EventEmitter();
  private active = new Map<string, Download>();
  private subscription: Subscription | undefined;
  private disposed = false;

  private constructor(
    private connector: BiDiConnector,
    private tree: ContextTree,
    private contextId: string,
    private timeout: number,
  ) {}

  public static async start(
    connector: BiDiConnector,
    tree: ContextTree,
    contextId: string,
    options: { timeout: number },
  ): Promise<DownloadTracker> {
    const tracker = new DownloadTracker(connector, tree, contextId, options.timeout);
    connector.onEvent("browsingContext.downloadWillBegin", tracker.onBegin);
    connector.onEvent("browsingContext.downloadEnd", tracker.onEnd);
    try {
      tracker.subscription = await connector.subscribe([
        "browsingContext.downloadWillBegin",
        "browsingContext.downloadEnd",
      ]);
    } catch (err) {
      tracker.removeListeners();
      throw err;
    }
    return tracker;
  }

  public on(event: "download", listener: (...args: EventMap["download"]) => void): void {
    this.events.on(event, listener as (...args: unknown[]) => void);
  }

  public off(event: "download", listener: (...args: EventMap["download"]) => void): void {
    this.events.off(event, listener as (...args: unknown[]) => void);
  }

  /** Stops tracking; downloads still going on reject with "page closed". Idempotent */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.removeListeners();
    for (const download of this.active.values()) download.finish({ status: "closed" });
    this.active.clear();
    await this.subscription?.unsubscribe();
  }

  private removeListeners() {
    this.connector.offEvent("browsingContext.downloadWillBegin", this.onBegin);
    this.connector.offEvent("browsingContext.downloadEnd", this.onEnd);
  }

  private onBegin = (params: DownloadWillBeginParams) => {
    if (!this.tree.isWithin(params.context, this.contextId)) return;
    const download = new Download(params.url, params.suggestedFilename, this.timeout);
    this.active.set(params.navigation, download);
    for (const listener of this.events.rawListeners("download")) {
      try {
        listener(download);
      } catch (err) {
        logger.error("A download listener threw", { err });
      }
    }
  };

  private onEnd = (params: DownloadEndParams) => {
    const download = this.active.get(params.navigation);
    if (!download) return;
    this.active.delete(params.navigation);
    download.finish(
      params.status === "complete" ? { status: "complete", path: params.filepath } : { status: "canceled" },
    );
  };
}
