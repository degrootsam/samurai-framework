import EventEmitter from "node:events";
import type { BiDiCommands, BiDiEvents } from "../types/bidi.js";
import logger from "../logger/index.js";

interface BiDiMessage {
  id: number;
  method: string;
  params?: object | undefined;
}

export class BiDiConnector {
  private resolveMap: Map<
    number,
    {
      resolve: <M extends keyof BiDiCommands>(
        value: BiDiCommands[M]["result"],
      ) => void;
      reject: (reason: unknown) => void;
    }
  > = new Map();
  private currentId: number = 0;
  private webSocket: WebSocket;
  private eventEmitter: EventEmitter;

  constructor(ws: WebSocket) {
    this.webSocket = ws;
    this.webSocket.addEventListener("message", this.messageListener);
    this.webSocket.addEventListener("close", this.onWebsocketClose);
    this.webSocket.addEventListener("error", this.onWebsocketError);
    this.eventEmitter = new EventEmitter();
    console.info("BiDiConnector: Websocket handshake finished");
  }

  public static async connect(url: string) {
    console.log("Connecting to WebSocket");
    const ws = new WebSocket(url);
    return new Promise<BiDiConnector>((resolve, reject) => {
      console.log("Waiting for WebSocket handshake");
      ws.addEventListener("open", () => {
        console.log("WebSocket handshake finished");
        resolve(new BiDiConnector(ws));
      });
      ws.addEventListener("error", (err) => {
        console.error(err);
        reject(new Error("WebSocket connection failed"));
      });
    });
  }

  private onWebsocketClose = () => {
    this.rejectAll("Websocket closed");
  };

  private onWebsocketError = (ev: Event) => {
    this.rejectAll(ev);
  };

  private rejectAll(reason: unknown) {
    this.resolveMap.forEach(({ reject }) => reject(reason));
    this.resolveMap.clear();
  }

  private getId() {
    return this.currentId++;
  }

  public send<M extends keyof BiDiCommands>(
    method: M,
    params?: BiDiCommands[M]["params"],
  ): Promise<BiDiCommands[M]["result"]> {
    return new Promise((resolve, reject) => {
      try {
        const id = this.getId();
        this.resolveMap.set(id, { resolve, reject });
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
        targetToResolve.resolve(message.result);
        this.resolveMap.delete(message.id);
      }
    } else if (message.type === "event") {
      this.eventEmitter.emit(message.method, message.params);
    }
  };

  public kill() {
    this.webSocket.removeEventListener("message", this.messageListener);
    this.webSocket.removeEventListener("close", this.onWebsocketClose);
    this.webSocket.removeEventListener("error", this.onWebsocketError);
    this.rejectAll(new Error("BiDiConnector killed"));
    this.eventEmitter.removeAllListeners();
    this.webSocket.close();
  }
}
