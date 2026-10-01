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
const DEFAULT_COMMAND_TIMEOUT = 30000;

export interface ConnectorOptions {
  /** @default 30000 */
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
  private webSocket: WebSocket;
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

  private onWebsocketClose = () => {
    this.rejectAll(
      (pending) => new Error(`Websocket closed${pendingSuffix(pending)}`),
    );
  };

  private onWebsocketError = (ev: Event) => {
    this.rejectAll((pending) =>
      Object.assign(new Error(`Websocket error${pendingSuffix(pending)}`), {
        cause: ev,
      }),
    );
  };

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
    logger.debug("Received message from BiDi Websocket: ", message);
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
    this.rejectAll(
      (pending) => new Error(`BiDiConnector killed${pendingSuffix(pending)}`),
    );
    this.eventEmitter.removeAllListeners();
    this.webSocket.close();
  }
}

function pendingSuffix(pending: string[]) {
  return pending.length > 0 ? ` (pending: ${pending.join(", ")})` : "";
}
