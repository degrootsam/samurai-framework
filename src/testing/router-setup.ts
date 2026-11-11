import { afterEach, beforeEach, mock } from "node:test";
import { ContextTree } from "../browser/context-tree.js";
import logger from "../logger/index.js";
import { autoReply, FakeWebSocket, makeConnector } from "./fake-websocket.js";
import { Router } from "../network/router.js";

const TREE = [
  {
    context: "top",
    parent: null,
    children: [{ context: "frame", parent: "top", children: [] }],
  },
  { context: "other", parent: null, children: [] },
];

const stops: Array<() => void> = [];
export let warn: ReturnType<typeof mock.method>;
export let error: ReturnType<typeof mock.method>;

/** Mocks the logger's warn and error for each test and stops the auto-repliers afterwards. */
export function installRouterHooks() {
  beforeEach(() => {
    warn = mock.method(logger, "warn", () => logger);
    error = mock.method(logger, "error", () => logger);
  });
  afterEach(() => {
    mock.restoreAll();
    stops.splice(0).forEach((stop) => stop());
  });
}

interface Options {
  routeTimeout?: number;
  handlers?: Record<string, (params: any) => object | Error>;
  browser?: "firefox" | "chrome";
}

export async function setup({
  routeTimeout = 5000,
  handlers = {},
  browser,
}: Options = {}) {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  if (browser) connector.browserName = browser;
  let intercepts = 0;
  stops.push(
    autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: TREE }),
      "network.addIntercept": () => ({ intercept: `i${++intercepts}` }),
      ...handlers,
    }),
  );
  const tree = await ContextTree.create(connector);
  const router = new Router(connector, tree, "top", { routeTimeout });
  const commands = (method: string) =>
    ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
  const blocked = (
    id: string,
    url: string,
    extra: {
      context?: string;
      intercepts?: string[];
      isBlocked?: boolean;
      method?: string;
      headers?: Array<{ name: string; value: object }>;
    } = {},
  ) =>
    ws.emitEvent("network.beforeRequestSent", {
      context: extra.context ?? "top",
      isBlocked: extra.isBlocked ?? true,
      intercepts: extra.intercepts ?? ["i1"],
      navigation: null,
      redirectCount: 0,
      timestamp: 0,
      request: {
        request: id,
        url,
        method: extra.method ?? "GET",
        headers: extra.headers ?? [
          { name: "Accept", value: { type: "string", value: "*/*" } },
        ],
        cookies: [],
        headersSize: 0,
        bodySize: null,
        destination: "script",
        initiatorType: "fetch",
        timings: {},
      },
    });
  return { ws, router, commands, blocked };
}

export const header = (name: string, value: string) => ({
  name,
  value: { type: "string", value },
});
