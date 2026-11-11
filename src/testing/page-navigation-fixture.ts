import Page from "../browser/page.js";
import { autoReply, FakeWebSocket, makeConnector } from "./fake-websocket.js";

export const success = (value: string) => ({
  type: "success",
  realm: "r",
  result: { type: "string", value },
});
const TREE = [{ context: "ctx-1", parent: null, children: [] }];

export function navPage(
  handlers: Record<string, (params: any) => object | Error> = {},
  settings?: ConstructorParameters<typeof Page>[2],
) {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  const stop = autoReply(ws, {
    "browsingContext.navigate": (params) => ({
      navigation: "nav-1",
      url: params.url,
    }),
    "browsingContext.getTree": () => ({ contexts: TREE }),
    "script.callFunction": () => success("complete"),
    ...handlers,
  });
  const page = new Page(connector, "ctx-1", settings);
  const navigates = () =>
    ws.sent
      .filter((m) => m.method === "browsingContext.navigate")
      .map((m) => m.params as any);
  return { ws, page, stop, navigates };
}
