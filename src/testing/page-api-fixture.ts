import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Page from "../browser/page.js";
import { autoReply, FakeWebSocket, makeConnector } from "./fake-websocket.js";

const TREE = [{ context: "ctx-1", parent: null, children: [] }];
export const str = (value: string) => ({
  type: "success",
  realm: "r",
  result: { type: "string", value },
});
export const PNG = Buffer.from("PNG-bytes");
export const PDF = Buffer.from("%PDF-1.7 fake");

export function apiPage(
  handlers: Record<string, (params: any) => object | Error> = {},
  settings?: ConstructorParameters<typeof Page>[2],
) {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  const stop = autoReply(ws, {
    "browsingContext.getTree": () => ({ contexts: TREE }),
    "browsingContext.captureScreenshot": () => ({
      data: PNG.toString("base64"),
    }),
    "browsingContext.print": () => ({ data: PDF.toString("base64") }),
    "script.callFunction": () => ({
      type: "success",
      realm: "realm-1",
      result: { type: "undefined" },
    }),
    "browsingContext.reload": () => ({
      navigation: "nav-2",
      url: "https://example.test/",
    }),
    ...handlers,
  });
  const page = new Page(connector, "ctx-1", settings);
  const commands = (method: string) =>
    ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
  return { ws, page, stop, commands };
}
export const bidiError = (code: string, message = "nope") =>
  Object.assign(new Error(message), { code });
export const tmp = () => mkdtempSync(path.join(tmpdir(), "samurai-page-api-"));
