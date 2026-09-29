import EventEmitter from "node:events";
import logger from "../logger/index.js";
import { fromRemoteValue } from "../script/serialize.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { Subscription } from "../transport/subscriptions.js";
import type { ConsoleLogEntry, Entry, Level } from "../types/bidi-modules/log.js";
import type { StackFrame, StackTrace } from "../types/bidi-modules/script.js";
import type { ContextTree } from "./context-tree.js";

/** How many entries a page keeps before the oldest are dropped */
const DEFAULT_MAX_ENTRIES = 1000;

/** One line of the browser's log, as kept for reports */
export interface LogRecord {
  level: Level;
  /** "console", "javascript" (an uncaught exception), or another type the browser reports */
  type: string;
  /** The console method, for `type: "console"` */
  method?: string;
  text: string;
  timestamp: number;
}

export interface SourceLocation {
  url: string;
  lineNumber: number;
  columnNumber: number;
}

/** A call to `console.log`, `console.warn`, … in the page */
export class ConsoleMessage {
  constructor(
    /** "debug" | "info" | "warn" | "error" */
    public readonly level: Level,
    private readonly method: string,
    private readonly message: string,
    /** The arguments as plain values; DOM nodes and functions stay opaque (ElementHandle, RemoteObject) */
    public readonly args: unknown[],
    public readonly timestamp: number,
    public readonly stackTrace?: StackTrace,
  ) {}

  /** The console method: "log", "warn", "error", "info", "debug", … */
  public type(): string {
    return this.method;
  }

  /** What the browser prints for the call */
  public text(): string {
    return this.message;
  }

  /** Where the call was made, when the browser says */
  public location(): SourceLocation | undefined {
    const frame = this.stackTrace?.callFrames[0];
    return frame && { url: frame.url, lineNumber: frame.lineNumber, columnNumber: frame.columnNumber };
  }
}

/** An exception nobody caught in the page */
export class PageError extends Error {
  public readonly timestamp: number;

  constructor(text: string, timestamp: number, stackTrace?: StackTrace) {
    super(text);
    this.name = "PageError";
    this.timestamp = timestamp;
    this.stack = [text, ...(stackTrace?.callFrames ?? []).map(formatFrame)].join("\n");
  }
}

function formatFrame({ functionName, url, lineNumber, columnNumber }: StackFrame): string {
  const where = `${url}:${lineNumber}:${columnNumber}`;
  return functionName ? `    at ${functionName} (${where})` : `    at ${where}`;
}

interface EventMap {
  console: [ConsoleMessage];
  pageerror: [PageError];
}
export type LogEventName = keyof EventMap;

/**
 * Collects the browser's log (`console.*` calls and uncaught exceptions) of one page, frames included,
 * in a ring buffer, and emits `console` and `pageerror` events.
 */
export class PageLogs {
  private events = new EventEmitter();
  private buffer: LogRecord[] = [];
  private uncaught: PageError[] = [];
  private droppedCount = 0;
  private disposed = false;
  private subscription: Subscription | undefined;

  private constructor(
    private connector: BiDiConnector,
    private tree: ContextTree,
    private contextId: string,
    private maxEntries: number,
  ) {}

  public static async start(
    connector: BiDiConnector,
    tree: ContextTree,
    contextId: string,
    options: { maxEntries?: number } = {},
  ): Promise<PageLogs> {
    const logs = new PageLogs(connector, tree, contextId, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    connector.onEvent("log.entryAdded", logs.onEntry);
    try {
      logs.subscription = await connector.subscribe(["log.entryAdded"]);
    } catch (err) {
      connector.offEvent("log.entryAdded", logs.onEntry);
      throw err;
    }
    return logs;
  }

  /** The newest entries, oldest first (a copy) */
  public get entries(): readonly LogRecord[] {
    return [...this.buffer];
  }

  /** Uncaught exceptions seen since the start or the last `clear()` */
  public get errors(): readonly PageError[] {
    return [...this.uncaught];
  }

  /** How many entries fell out of the buffer */
  public get dropped(): number {
    return this.droppedCount;
  }

  public on<E extends LogEventName>(event: E, listener: (...args: EventMap[E]) => void): void {
    this.events.on(event, listener as (...args: unknown[]) => void);
  }

  public off<E extends LogEventName>(event: E, listener: (...args: EventMap[E]) => void): void {
    this.events.off(event, listener as (...args: unknown[]) => void);
  }

  public clear(): void {
    this.buffer = [];
    this.uncaught = [];
    this.droppedCount = 0;
  }

  /** Idempotent */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.connector.offEvent("log.entryAdded", this.onEntry);
    this.buffer = [];
    this.uncaught = [];
    await this.subscription?.unsubscribe();
  }

  private onEntry = (entry: Entry) => {
    const context = entry.source.context;
    // Worker realms have no context; entries of other pages are not ours
    if (!context || !this.tree.isWithin(context, this.contextId)) return;

    const text = entry.text ?? "";
    const record: LogRecord = {
      level: entry.level,
      type: entry.type,
      ...(entry.type === "console" && { method: (entry as ConsoleLogEntry).method }),
      text,
      timestamp: entry.timestamp,
    };
    this.buffer.push(record);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
      this.droppedCount++;
    }

    if (entry.type === "console") {
      const consoleEntry = entry as ConsoleLogEntry;
      this.emit(
        "console",
        new ConsoleMessage(
          entry.level,
          consoleEntry.method,
          text,
          (consoleEntry.args ?? []).map((arg) => fromRemoteValue(arg)),
          entry.timestamp,
          entry.stackTrace,
        ),
      );
    } else if (entry.type === "javascript") {
      const error = new PageError(text, entry.timestamp, entry.stackTrace);
      this.uncaught.push(error);
      if (this.uncaught.length > this.maxEntries) this.uncaught.shift();
      this.emit("pageerror", error);
    }
  };

  /** A listener that throws must not stop the recording or the other listeners */
  private emit<E extends LogEventName>(event: E, ...args: EventMap[E]) {
    for (const listener of this.events.rawListeners(event)) {
      try {
        listener(...args);
      } catch (err) {
        logger.error("A %s listener threw", event, { err });
      }
    }
  }
}
