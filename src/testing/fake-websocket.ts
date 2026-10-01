/**
 * Minimal WebSocket stand-in for BiDiConnector unit tests. Commands the connector sends are
 * recorded in `sent`; tests answer them with `reply` and push events with `emitEvent`.
 */
export class FakeWebSocket extends EventTarget {
  /** Every command the connector sent, parsed */
  public readonly sent: Array<{ id: number; method: string; params?: unknown }> = [];
  public closed = false;

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
  }

  private receive(message: object) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  reply(id: number, result: object = {}) {
    this.receive({ type: "success", id, result });
  }

  replyError(id: number | null, error: string, message = "boom", stacktrace?: string) {
    this.receive({ type: "error", id, error, message, stacktrace });
  }

  emitEvent(method: string, params: object) {
    this.receive({ type: "event", method, params });
  }

  /** Simulates the socket closing */
  drop() {
    this.dispatchEvent(new Event("close"));
  }
}

/** Waits one macrotask so the connector's promise callbacks and timers have run */
export function tick(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Answers every command the connector sends. `handlers` maps a method to its result;
 * unknown methods get `{}`; `session.subscribe` gets a fresh subscription id unless a handler answers it.
 * A handler that returns an Error with a `code` property answers with that BiDi error code.
 */
export function autoReply(
  ws: FakeWebSocket,
  handlers: Record<string, (params: any) => object | Error> = {},
) {
  let answered = 0;
  let subscriptions = 0;
  const pump = setInterval(() => {
    while (answered < ws.sent.length) {
      const { id, method, params } = ws.sent[answered++]!;
      const handler = handlers[method];
      if (method === "session.subscribe" && !handler) {
        ws.reply(id, { subscription: `sub-${++subscriptions}` });
        continue;
      }
      const result = handler?.(params) ?? {};
      // An Error with a `code` answers with that BiDi error code
      if (result instanceof Error) ws.replyError(id, (result as { code?: string }).code ?? "unknown error", result.message);
      else if (method === "session.subscribe") ws.reply(id, { subscription: `sub-${++subscriptions}`, ...result });
      else ws.reply(id, result);
    }
  }, 1).unref();
  return () => clearInterval(pump);
}
