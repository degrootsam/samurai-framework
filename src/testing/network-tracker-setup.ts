import { afterEach } from "node:test";
import { ContextTree } from "../browser/context-tree.js";
import { autoReply, FakeWebSocket, makeConnector } from "./fake-websocket.js";
import {
  NetworkTracker,
  type NetworkRequest,
} from "../network/network-tracker.js";

const TREE = [
  {
    context: "top",
    parent: null,
    children: [{ context: "frame", parent: "top", children: [] }],
  },
  { context: "other", parent: null, children: [] },
];

const stops: Array<() => void> = [];

export function installTrackerHooks() {
  afterEach(() => stops.splice(0).forEach((stop) => stop()));
}

export async function setup(
  options?: { ignore?: (r: NetworkRequest) => boolean },
  browserName: "firefox" | "chrome" = "firefox",
) {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  connector.browserName = browserName;
  stops.push(
    autoReply(ws, { "browsingContext.getTree": () => ({ contexts: TREE }) }),
  );
  const tree = await ContextTree.create(connector);
  const tracker = await NetworkTracker.start(connector, tree, "top", options);
  return { ws, tracker };
}

function requestData(
  id: string,
  url = `https://example.test/${id}`,
  extra: object = {},
) {
  return {
    request: id,
    url,
    method: "GET",
    headers: [
      { name: "Accept", value: { type: "string", value: "text/html" } },
    ],
    cookies: [],
    headersSize: 0,
    bodySize: null,
    destination: "script",
    initiatorType: "script",
    timings: {},
    ...extra,
  };
}
export const base = (
  id: string,
  context: string | null,
  extra: { redirectCount?: number; url?: string; isBlocked?: boolean } = {},
) => ({
  context,
  isBlocked: extra.isBlocked ?? false,
  navigation: null,
  redirectCount: extra.redirectCount ?? 0,
  request: requestData(id, extra.url),
  timestamp: 0,
});
const response = (
  status = 200,
  headers: Array<{ name: string; value: object }> = [],
) => ({
  url: "https://example.test/x",
  protocol: "http/1.1",
  status,
  statusText: "OK",
  fromCache: false,
  headers,
  mimeType: "text/plain",
  bytesReceived: 0,
  headersSize: 0,
  bodySize: 0,
  content: { size: 0 },
});
export const start = (
  ws: FakeWebSocket,
  id: string,
  context: string | null = "top",
  extra = {},
) => ws.emitEvent("network.beforeRequestSent", base(id, context, extra));
export const done = (
  ws: FakeWebSocket,
  id: string,
  context: string | null = "top",
  extra: {
    redirectCount?: number;
    status?: number;
    headers?: Array<{ name: string; value: object }>;
  } = {},
) =>
  ws.emitEvent("network.responseCompleted", {
    ...base(id, context, extra),
    response: response(extra.status, extra.headers),
  });
export const fail = (
  ws: FakeWebSocket,
  id: string,
  context: string | null = "top",
  extra = {},
) =>
  ws.emitEvent("network.fetchError", {
    ...base(id, context, extra),
    errorText: "NS_ERROR_NET_RESET",
  });
