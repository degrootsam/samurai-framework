import EventEmitter from "node:events";
import { autoReply, FakeWebSocket, makeConnector } from "./fake-websocket.js";
import { Browser } from "../browser/browser.js";

export const stops: Array<() => void> = [];
export const failing = (code: string, message = "nope") =>
  Object.assign(new Error(message), { code });

export function setup(
  handlers: Record<string, (params: any) => object | Error> = {},
) {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  let contexts = 0;
  let tabs = 0;
  stops.push(
    autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: [] }),
      "browser.createUserContext": () => ({ userContext: `u${++contexts}` }),
      "browser.removeUserContext": () => ({}),
      "browsingContext.create": (params) => ({
        context: `tab-${++tabs}`,
        userContext: params.userContext ?? "default",
      }),
      "storage.setCookie": () => ({ partitionKey: {} }),
      "storage.getCookies": () => ({ cookies: [], partitionKey: {} }),
      "storage.deleteCookies": () => ({ partitionKey: {} }),
      ...handlers,
    }),
  );
  const proc = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill() {
      queueMicrotask(() => proc.emit("exit"));
    },
  });
  const browser = new Browser({
    browserProc: proc as never,
    biDiConnector: connector,
  });
  const commands = (method: string) =>
    ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
  return { ws, browser, commands };
}
