import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Page from "./page.js";
import {
  autoReply,
  FakeWebSocket,
  tick,
  makeConnector,
} from "../testing/fake-websocket.js";

describe("Page routing", () => {
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];
  function routedPage(settings?: ConstructorParameters<typeof Page>[2]) {
    const ws = new FakeWebSocket();
    const connector = makeConnector(ws);
    let intercepts = 0;
    const stop = autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: TREE }),
      "network.addIntercept": () => ({ intercept: `i${++intercepts}` }),
    });
    const page = new Page(connector, "ctx-1", settings);
    const commands = (method: string) =>
      ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
    const blocked = (id: string, url: string) =>
      ws.emitEvent("network.beforeRequestSent", {
        context: "ctx-1",
        isBlocked: true,
        intercepts: ["i1"],
        navigation: null,
        redirectCount: 0,
        timestamp: 0,
        request: {
          request: id,
          url,
          method: "GET",
          headers: [],
          cookies: [],
          headersSize: 0,
          bodySize: null,
          destination: "",
          initiatorType: "fetch",
          timings: {},
        },
      });
    return { ws, page, stop, commands, blocked };
  }

  test("route intercepts this page's requests and answers them", async () => {
    const { page, stop, commands, blocked } = routedPage();
    await page.route("**/api/users", (route) =>
      route.fulfill({ json: [{ id: 1 }] }),
    );
    assert.deepEqual(commands("network.addIntercept"), [
      { phases: ["beforeRequestSent"], contexts: ["ctx-1"] },
    ]);
    blocked("r1", "https://example.test/api/users");
    await tick(30);
    assert.equal(commands("network.provideResponse")[0].statusCode, 200);
    stop();
  });

  test("unroute and unrouteAll take routes away; before any route they do nothing", async () => {
    const { ws, page, stop, commands } = routedPage();
    await page.unroute("**/nothing");
    await page.unrouteAll();
    assert.equal(ws.sent.length, 0, "no router was created for that");
    await page.route("**/a", () => {});
    await page.unroute("**/a");
    assert.equal(commands("network.removeIntercept").length, 1);
    await page.route("**/b", () => {});
    await page.unrouteAll();
    assert.equal(commands("network.removeIntercept").length, 2);
    stop();
  });

  test("errors thrown by route handlers are available from routeErrors", async () => {
    const { page, stop, blocked } = routedPage();
    assert.deepEqual(page.routeErrors(), []);
    await page.route("**", () => {
      throw new Error("handler bug");
    });
    blocked("r1", "https://example.test/x");
    await tick(30);
    assert.equal(page.routeErrors().length, 1);
    assert.match(page.routeErrors()[0]!.message, /handler bug/);
    stop();
  });

  test("the route timeout comes from config network.routeTimeout", async () => {
    const { page, stop, commands, blocked } = routedPage({
      network: { routeTimeout: 40 },
    });
    await page.route("**", async () => {
      await tick(300);
    });
    blocked("r1", "https://example.test/x");
    await tick(120);
    assert.deepEqual(commands("network.continueRequest"), [{ request: "r1" }]);
    stop();
  });

  test("dispose removes the intercept and lets held requests continue", async () => {
    const { page, stop, commands, blocked } = routedPage();
    await page.route("**", async () => {
      await tick(500);
    });
    blocked("r1", "https://example.test/x");
    await tick(20);
    await page.dispose();
    assert.deepEqual(commands("network.continueRequest"), [{ request: "r1" }]);
    assert.equal(commands("network.removeIntercept").length, 1);
    stop();
  });
});
