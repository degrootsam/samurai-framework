import type EventEmitter from "node:events";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";
import type { ContextTree } from "./context-tree.js";
import { Lazy } from "./lazy.js";
import { PageLogs, type LogRecord, type PageError } from "./page-logs.js";

/** A page's console and error collection: started on demand, read at once, and whether the runner may fail on its errors */
export class PageLogging {
  private lazyLogs = new Lazy<PageLogs>();
  private errorsAllowed = false;

  constructor(
    private readonly connector: BiDiConnector,
    private readonly contextId: BrowsingContext,
    private readonly tree: () => Promise<ContextTree>,
    private readonly emitter: EventEmitter,
  ) {}

  public async start(): Promise<void> {
    await this.lazyLogs.get(async () => {
      const logs = await PageLogs.start(
        this.connector,
        await this.tree(),
        this.contextId,
      );
      logs.on("console", (message) => this.emitter.emit("console", message));
      logs.on("pageerror", (error) => this.emitter.emit("pageerror", error));
      return logs;
    });
  }

  /** Forgets the collection and hands back its start, for the caller to dispose; undefined when it never started */
  public take(): Promise<PageLogs> | undefined {
    return this.lazyLogs.take();
  }

  public entries(): readonly LogRecord[] {
    return this.lazyLogs.peek()?.entries ?? [];
  }

  public errors(): readonly PageError[] {
    return this.lazyLogs.peek()?.errors ?? [];
  }

  public get dropped(): number {
    return this.lazyLogs.peek()?.dropped ?? 0;
  }

  public clear(): void {
    this.lazyLogs.peek()?.clear();
  }

  public allowErrors(): void {
    this.errorsAllowed = true;
  }

  public get errorsAreAllowed(): boolean {
    return this.errorsAllowed;
  }
}
