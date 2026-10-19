import EventEmitter from "node:events";
import type { BiDiCommands, BiDiEvents } from "../types/bidi.js";
import logger from "../logger/index.js";
import { WaitTimeoutError } from "../wait/wait-until.js";
import { BiDiError } from "./bidi-error.js";
import {
  SubscriptionManager,
  type EventName,
  type Subscription,
  type SubscribeOptions,
} from "./subscriptions.js";

/** Time (ms) a command may wait for its reply before it fails with code "timeout" */
export const DEFAULT_COMMAND_TIMEOUT = 30000;

export interface ConnectorOptions {
  /** @default DEFAULT_COMMAND_TIMEOUT */
  commandTimeout?: number;
}

export interface SendOptions {
  /** Overrides the connector's commandTimeout for this command */
  timeout?: number;
}

interface BiDiMessage {
  id: number;
  method: string;
  params?: object | undefined;
}

/**
 * The connection to the browser is gone (the browser exited or was closed, or the socket dropped). Commands that
 * were waiting fail with it, and so does every command sent afterwards: a closed socket would swallow them silently.
 */
export class ConnectionClosedError extends Error {
  public readonly cause: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ConnectionClosedError";
    this.cause = options?.cause;
  }
}

export class BiDiConnector {
  private resolveMap: Map<
    number,
    {
      method: string;
      resolve: <M extends keyof BiDiCommands>(
        value: BiDiCommands[M]["result"],
      ) => void;
      reject: (reason: unknown) => void;
    }
  > = new Map();
  private currentId: number = 0;
  /** Set once the socket closed or failed: nothing sent after that gets an answer */
  private closed = false;
  /** Which browser is on the other end, when the launcher says; code that must treat browsers apart asks this */
  public browserName?: "firefox" | "chrome";
  private webSocket: WebSocket;
  private closeListeners = new Set<() => void>();
  private eventEmitter: EventEmitter;
  private commandTimeout: number;
  private subscriptions: SubscriptionManager;

  constructor(ws: WebSocket, options: ConnectorOptions = {}) {
    this.commandTimeout = options.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT;
    this.subscriptions = new SubscriptionManager({
      subscribe: (params) => this.send("session.subscribe", params),
      unsubscribe: (params) => this.send("session.unsubscribe", params),
    });
    this.webSocket = ws;
    this.webSocket.addEventListener("message", this.messageListener);
    this.webSocket.addEventListener("close", this.onWebsocketClose);
    this.webSocket.addEventListener("error", this.onWebsocketError);
    this.eventEmitter = new EventEmitter();
    logger.debug("BiDiConnector: Websocket handshake finished");
  }

  public static async connect(url: string, options?: ConnectorOptions) {
    logger.debug("Connecting to WebSocket");
    const ws = new WebSocket(url);
    return new Promise<BiDiConnector>((resolve, reject) => {
      logger.debug("Waiting for WebSocket handshake");
      ws.addEventListener("open", () => {
        logger.debug("WebSocket handshake finished");
        resolve(new BiDiConnector(ws, options));
      });
      ws.addEventListener("error", (err) => {
        logger.debug("WebSocket error", { err });
        reject(new Error("WebSocket connection failed"));
      });
    });
  }

  /** Calls `listener` once when the socket closes or fails (not when `kill()` ends it) */
  public onClosed(listener: () => void): void {
    this.closeListeners.add(listener);
  }

  private notifyClosed() {
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    for (const listener of listeners) listener();
  }

  private onWebsocketClose = () => {
    this.closed = true;
    this.notifyClosed();
    this.rejectAll(
      (pending) =>
        new ConnectionClosedError(`Websocket closed${pendingSuffix(pending)}`),
    );
  };

  private onWebsocketError = (ev: Event) => {
    this.closed = true;
    this.notifyClosed();
    this.rejectAll(
      (pending) =>
        new ConnectionClosedError(`Websocket error${pendingSuffix(pending)}`, {
          cause: ev,
        }),
    );
  };

  private get isClosed(): boolean {
    // A socket that is closing or closed (readyState 2 or 3) has already lost the browser
    const state = (this.webSocket as { readyState?: number }).readyState;
    return this.closed || (typeof state === "number" && state > 1);
  }

  /** Rejects every pending command; `reason` gets the pending method names for its message */
  private rejectAll(reason: (pendingMethods: string[]) => unknown) {
    const entries = [...this.resolveMap.values()];
    const error = reason(entries.map((entry) => entry.method));
    this.resolveMap.clear();
    entries.forEach(({ reject }) => reject(error));
  }

  private getId() {
    return this.currentId++;
  }

  public send<M extends keyof BiDiCommands>(
    method: M,
    params?: BiDiCommands[M]["params"],
    options: SendOptions = {},
  ): Promise<BiDiCommands[M]["result"]> {
    return new Promise((resolve, reject) => {
      try {
        if (this.isClosed) {
          // Sending on a closed socket is silently dropped: without this the command waits out its timeout
          throw new ConnectionClosedError(
            `Websocket closed: cannot send ${method}`,
          );
        }
        const id = this.getId();
        const timeout = options.timeout ?? this.commandTimeout;
        const timer = setTimeout(() => {
          this.resolveMap.delete(id);
          reject(
            new BiDiError(method, "timeout", `no reply within ${timeout}ms`),
          );
        }, timeout);
        this.resolveMap.set(id, {
          method,
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (reason) => {
            clearTimeout(timer);
            reject(reason);
          },
        });
        const commandBody: BiDiMessage = {
          id,
          method,
          params,
        };
        logger.debug("Sending message to BiDi Websocket", commandBody);
        this.webSocket.send(JSON.stringify(commandBody));
      } catch (err: unknown) {
        reject(err);
      }
    });
  }

  /**
   * Subscribes to events. Unscoped subscriptions are refcounted per event, so features can
   * subscribe independently; scoped ones (`contexts`) always send their own command.
   */
  public subscribe(
    events: EventName[],
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    return this.subscriptions.subscribe(events, options);
  }

  /**
   * Resolves with the params of the first `event` for which `predicate` is true.
   * The listener is registered before this returns, so start the triggering command afterwards.
   * Rejects with WaitTimeoutError after `timeout` ms, or with the abort reason.
   */
  public waitForEvent<E extends keyof BiDiEvents>(
    event: E,
    predicate: (params: BiDiEvents[E]["params"]) => boolean,
    options: { timeout: number; signal?: AbortSignal },
  ): Promise<BiDiEvents[E]["params"]> {
    const { timeout, signal } = options;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const cleanup = () => {
        clearTimeout(timer);
        this.offEvent(event, listener);
        signal?.removeEventListener("abort", onAbort);
      };
      const listener = (params: BiDiEvents[E]["params"]) => {
        if (!predicate(params)) return;
        cleanup();
        resolve(params);
      };
      const onAbort = () => {
        cleanup();
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new WaitTimeoutError<undefined>(timeout, undefined));
      }, timeout);
      this.onEvent(event, listener);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Register an event listener */
  public onEvent<E extends keyof BiDiEvents>(
    event: E,
    listener: (params: BiDiEvents[E]["params"]) => void,
  ): void {
    this.eventEmitter.on(event, listener);
  }

  /** Remove an event listener */
  public offEvent<E extends keyof BiDiEvents>(
    event: E,
    listener: (params: BiDiEvents[E]["params"]) => void,
  ): void {
    this.eventEmitter.off(event, listener);
  }

  private messageListener = (ev: MessageEvent) => {
    const message = JSON.parse(ev.data);
    logger.debug("Received message from BiDi Websocket: ", forLog(message));
    if (message.type === "success" && message.id !== undefined) {
      const targetToResolve = this.resolveMap.get(message.id);
      if (targetToResolve) {
        this.resolveMap.delete(message.id);
        targetToResolve.resolve(message.result);
      }
    } else if (message.type === "error") {
      const target =
        message.id === null || message.id === undefined
          ? undefined
          : this.resolveMap.get(message.id);
      if (!target) {
        logger.debug("BiDi error reply without a pending command", message);
        return;
      }
      this.resolveMap.delete(message.id);
      target.reject(
        new BiDiError(
          target.method,
          message.error,
          message.message,
          message.stacktrace,
        ),
      );
    } else if (message.type === "event") {
      this.eventEmitter.emit(message.method, message.params);
    }
  };

  public kill() {
    this.webSocket.removeEventListener("message", this.messageListener);
    this.webSocket.removeEventListener("close", this.onWebsocketClose);
    this.webSocket.removeEventListener("error", this.onWebsocketError);
    this.closed = true;
    this.rejectAll(
      (pending) =>
        new ConnectionClosedError(
          `BiDiConnector killed${pendingSuffix(pending)}`,
        ),
    );
    this.eventEmitter.removeAllListeners();
    this.webSocket.close();
  }
}

/** Channels whose messages carry what the tester typed (the recorder's) or adds as a secret (its toolbar's) */
const PRIVATE_CHANNEL = /^samurai-(recorder|toolbar)-/;

/**
 * The message as the debug log gets it: a `script.message` on a private channel is logged by channel and
 * action only, so a value the tester types or a secret added from the recorder toolbar never reaches the log
 * (an added secret is only registered for masking after it is saved).
 */
export function forLog(message: {
  type?: string;
  method?: string;
  params?: { channel?: unknown; data?: unknown };
}): unknown {
  return shortened(redacted(message));
}

/** A string longer than this is cut in the log: a file's bytes travel in 1 MB chunks, 50 MB makes 70 MB of debug log */
const LOG_STRING_LIMIT = 1000;

/** A copy of `value` with every long string cut to its start and its length; short values come back as they are */
function shortened(value: unknown, depth = 0): unknown {
  if (typeof value === "string")
    return value.length > LOG_STRING_LIMIT
      ? `${value.slice(0, 200)}… (${value.length} characters)`
      : value;
  if (value === null || typeof value !== "object" || depth > 30) return value;
  if (Array.isArray(value))
    return value.map((item) => shortened(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      shortened(item, depth + 1),
    ]),
  );
}

function redacted(message: {
  type?: string;
  method?: string;
  params?: { channel?: unknown; data?: unknown };
}): unknown {
  const channel = message.params?.channel;
  if (
    message.type !== "event" ||
    message.method !== "script.message" ||
    typeof channel !== "string" ||
    !PRIVATE_CHANNEL.test(channel)
  )
    return message;
  const entries = (message.params?.data as { value?: unknown } | undefined)
    ?.value;
  const field = (key: string) => {
    if (!Array.isArray(entries)) return undefined;
    const entry = entries.find(
      (pair): pair is [string, { value?: unknown }] =>
        Array.isArray(pair) && pair[0] === key,
    );
    const value = entry?.[1]?.value;
    return typeof value === "string" ? value : undefined;
  };
  return {
    ...message,
    params: {
      ...message.params,
      data: { type: field("type"), action: field("action"), redacted: true },
    },
  };
}

function pendingSuffix(pending: string[]) {
  return pending.length > 0 ? ` (pending: ${pending.join(", ")})` : "";
}
