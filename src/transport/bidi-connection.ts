interface BiDiMessage {
  id: number;
  method: string;
  params: object;
}

export class BiDiConnector {
  private resolveMap: Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  > = new Map();
  private currentId: number = 0;
  private webSocket: WebSocket;

  constructor({ url }: { url: string }) {
    this.webSocket = new WebSocket(url);
    this.webSocket.addEventListener("message", this.messageListener);
    this.webSocket.addEventListener("close", this.onWebsocketClose);
    this.webSocket.addEventListener("error", this.onWebsocketError);
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

  public send(method: string, params: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      try {
        const id = this.getId();
        this.resolveMap.set(id, { resolve, reject });
        const commandBody: BiDiMessage = {
          id,
          method,
          params,
        };
        this.webSocket.send(JSON.stringify(commandBody));
      } catch (err: unknown) {
        reject(err);
      }
    });
  }

  private messageListener = (ev: MessageEvent) => {
    const { id, result } = JSON.parse(ev.data);
    const targetToResolve = this.resolveMap.get(id);
    if (targetToResolve) {
      targetToResolve.resolve(result);
      this.resolveMap.delete(id);
    }
  };
}
