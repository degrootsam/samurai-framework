import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { ContextTree } from "../browser/context-tree.js";
import logger from "../logger/index.js";
import { autoReply, FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { Router, type Route } from "./router.js";

const TREE = [
  { context: "top", parent: null, children: [{ context: "frame", parent: "top", children: [] }] },
  { context: "other", parent: null, children: [] },
];

const stops: Array<() => void> = [];
let warn: ReturnType<typeof mock.method>;
let error: ReturnType<typeof mock.method>;
beforeEach(() => {
  warn = mock.method(logger, "warn", () => logger);
  error = mock.method(logger, "error", () => logger);
});
afterEach(() => {
  mock.restoreAll();
  stops.splice(0).forEach((stop) => stop());
});

interface Options {
  routeTimeout?: number;
  handlers?: Record<string, (params: any) => object | Error>;
}

async function setup({ routeTimeout = 5000, handlers = {} }: Options = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
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
  const commands = (method: string) => ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
  const blocked = (id: string, url: string, extra: { context?: string; intercepts?: string[]; isBlocked?: boolean; method?: string; headers?: Array<{ name: string; value: object }> } = {}) =>
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
        headers: extra.headers ?? [{ name: "Accept", value: { type: "string", value: "*/*" } }],
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

const header = (name: string, value: string) => ({ name, value: { type: "string", value } });

describe("registering routes", () => {
  it("sends one intercept, for this page, however many routes", async () => {
    const { router, commands } = await setup();
    await router.route("**/api/**", () => {});
    await router.route(/\.png$/, () => {});
    assert.deepEqual(commands("network.addIntercept"), [{ phases: ["beforeRequestSent"], contexts: ["top"] }]);
  });

  it("concurrent route() calls share one intercept", async () => {
    const { router, commands } = await setup();
    await Promise.all([router.route("**/a", () => {}), router.route("**/b", () => {}), router.route(/c/, () => {})]);
    assert.equal(commands("network.addIntercept").length, 1);
  });

  it("with only exact URLs the browser is asked to block just those", async () => {
    const { router, commands } = await setup();
    await router.route("https://example.test/api/users", () => {});
    await router.route("https://example.test/api/items?page=1", () => {});
    assert.deepEqual(commands("network.addIntercept").map((c) => c.urlPatterns), [
      [{ type: "string", pattern: "https://example.test/api/users" }],
      [
        { type: "string", pattern: "https://example.test/api/users" },
        { type: "string", pattern: "https://example.test/api/items?page=1" },
      ],
    ]);
  });

  it("adding a glob widens the intercept: the new one is added before the old one is removed", async () => {
    const { ws, router } = await setup();
    await router.route("https://example.test/api/users", () => {});
    await router.route("**/images/*", () => {});
    const order = ws.sent.filter((m) => m.method === "network.addIntercept" || m.method === "network.removeIntercept").map((m) => m.method);
    assert.deepEqual(order, ["network.addIntercept", "network.addIntercept", "network.removeIntercept"]);
    assert.equal((ws.sent.filter((m) => m.method === "network.addIntercept")[1]!.params as any).urlPatterns, undefined);
    assert.deepEqual(ws.sent.find((m) => m.method === "network.removeIntercept")!.params, { intercept: "i1" });
  });

  it("an exact string that is not in URL-normal form is not handed to the browser as a pattern", async () => {
    const { router, commands } = await setup();
    await router.route("https://example.test", () => {}); // the browser would read it as https://example.test/
    assert.equal(commands("network.addIntercept")[0].urlPatterns, undefined);
  });

  it("falls back to blocking everything when the browser rejects url patterns, and remembers", async () => {
    const rejected = Object.assign(new Error("urlPatterns not supported"), { code: "invalid argument" });
    let attempts = 0;
    const { router, commands } = await setup({
      handlers: {
        "network.addIntercept": (params) => {
          attempts++;
          return params.urlPatterns ? rejected : { intercept: `i${attempts}` };
        },
      },
    });
    await router.route("https://example.test/a", () => {});
    await router.unrouteAll();
    await router.route("https://example.test/b", () => {});
    const withPatterns = commands("network.addIntercept").filter((c) => c.urlPatterns);
    assert.equal(withPatterns.length, 1, "asked once, then remembered");
  });
});

describe("what a blocked request does", () => {
  it("goes to the matching handler, with the request described", async () => {
    const { router, blocked } = await setup();
    let seen!: Route;
    await router.route("**/api/**", (route) => {
      seen = route;
      return route.continue();
    });
    blocked("r1", "https://example.test/api/users", { method: "POST", headers: [header("Content-Type", "application/json")] });
    await tick(20);
    const request = seen.request();
    assert.equal(request.url, "https://example.test/api/users");
    assert.equal(request.method, "POST");
    assert.deepEqual(request.headers, { "content-type": "application/json" });
    assert.equal(request.id, "r1");
  });

  it("continues unchanged when no route matches", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**/api/**", () => {});
    blocked("r1", "https://example.test/other.css");
    await tick(20);
    assert.deepEqual(commands("network.continueRequest"), [{ request: "r1" }]);
    assert.equal(commands("network.failRequest").length + commands("network.provideResponse").length, 0);
  });

  it("the newest matching route answers first; fallback passes to the next", async () => {
    const { router, blocked, commands } = await setup();
    const order: string[] = [];
    await router.route("**/api/**", (route) => {
      order.push("old");
      return route.fulfill({ status: 201 });
    });
    await router.route("**/api/users", async (route) => {
      order.push("new");
      await route.fallback();
    });
    blocked("r1", "https://example.test/api/users");
    await tick(30);
    assert.deepEqual(order, ["new", "old"]);
    assert.equal(commands("network.provideResponse")[0].statusCode, 201);
    assert.equal(commands("network.continueRequest").length, 0, "answered once");
  });

  it("fallback on the last matching route continues the request unchanged", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**/api/**", (route) => route.fallback());
    blocked("r1", "https://example.test/api/users");
    await tick(30);
    assert.deepEqual(commands("network.continueRequest"), [{ request: "r1" }]);
  });

  it("ignores requests that are not blocked, of other pages, or blocked by someone else's intercept", async () => {
    const { router, blocked, ws } = await setup();
    let calls = 0;
    await router.route("**", () => {
      calls++;
    });
    const before = ws.sent.length;
    blocked("r1", "https://e.test/a", { isBlocked: false });
    blocked("r2", "https://e.test/b", { context: "other" });
    blocked("r3", "https://e.test/c", { intercepts: ["someone-elses"] });
    await tick(30);
    assert.equal(calls, 0);
    assert.equal(ws.sent.length, before);
  });

  it("handles requests of an iframe of the page", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", (route) => route.abort());
    blocked("r1", "https://e.test/frame.js", { context: "frame" });
    await tick(20);
    assert.deepEqual(commands("network.failRequest"), [{ request: "r1" }]);
  });
});

describe("Route.fulfill", () => {
  async function fulfilled(options: Parameters<Route["fulfill"]>[0]) {
    const { router, blocked, commands } = await setup();
    await router.route("**", (route) => route.fulfill(options));
    blocked("r1", "https://example.test/x");
    await tick(20);
    return commands("network.provideResponse")[0];
  }

  it("answers 200 OK with no body by default", async () => {
    const sent = await fulfilled({});
    assert.deepEqual(sent, {
      request: "r1",
      statusCode: 200,
      reasonPhrase: "OK",
      headers: [header("content-length", "0")],
    });
  });

  it("json becomes the body, with its content type and length", async () => {
    const sent = await fulfilled({ json: [{ id: 1 }] });
    assert.deepEqual(sent.body, { type: "string", value: '[{"id":1}]' });
    assert.deepEqual(sent.headers, [header("content-type", "application/json"), header("content-length", "10")]);
  });

  it("a string body is sent as text, its length counted in bytes", async () => {
    const sent = await fulfilled({ status: 404, body: "héllo", contentType: "text/plain" });
    assert.equal(sent.statusCode, 404);
    assert.equal(sent.reasonPhrase, "Not Found");
    assert.deepEqual(sent.body, { type: "string", value: "héllo" });
    assert.deepEqual(sent.headers, [header("content-type", "text/plain"), header("content-length", "6")]);
  });

  it("a Buffer body is sent as base64", async () => {
    const sent = await fulfilled({ body: Buffer.from([0, 1, 2, 255]) });
    assert.deepEqual(sent.body, { type: "base64", value: Buffer.from([0, 1, 2, 255]).toString("base64") });
    assert.deepEqual(sent.headers.find((h: any) => h.name === "content-length"), header("content-length", "4"));
  });

  it("your headers win: content-type and content-length are only added when missing, whatever their case", async () => {
    const sent = await fulfilled({
      json: { a: 1 },
      headers: { "Content-Type": "application/vnd.api+json", "CONTENT-LENGTH": "99", "x-mock": "1" },
    });
    assert.deepEqual(sent.headers, [
      header("Content-Type", "application/vnd.api+json"),
      header("CONTENT-LENGTH", "99"),
      header("x-mock", "1"),
    ]);
  });

  it("json and body together are refused", async () => {
    const { router, blocked } = await setup();
    let failure: unknown;
    await router.route("**", async (route) => {
      failure = await route.fulfill({ json: 1, body: "x" }).catch((err: Error) => err);
      await route.abort();
    });
    blocked("r1", "https://example.test/x");
    await tick(30);
    assert.ok(failure instanceof TypeError);
  });
});

describe("Route.continue and Route.abort", () => {
  it("continue() sends only the request", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", (route) => route.continue());
    blocked("r1", "https://example.test/x");
    await tick(20);
    assert.deepEqual(commands("network.continueRequest"), [{ request: "r1" }]);
  });

  it("continue() overrides url, method and headers", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", (route) =>
      route.continue({
        url: "https://example.test/other",
        method: "PUT",
        headers: { ...route.request().headers, "x-test": "1" },
      }),
    );
    blocked("r1", "https://example.test/x");
    await tick(20);
    assert.deepEqual(commands("network.continueRequest"), [
      {
        request: "r1",
        url: "https://example.test/other",
        method: "PUT",
        headers: [header("accept", "*/*"), header("x-test", "1")],
      },
    ]);
  });

  it("a new body brings its own content-length: the browser would keep the old one and cut the body off", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", (route) => route.continue({ postData: "héllo body" }));
    blocked("r1", "https://example.test/x", {
      method: "POST",
      headers: [header("Accept", "*/*"), header("Content-Length", "4")],
    });
    await tick(20);
    assert.deepEqual(commands("network.continueRequest"), [
      {
        request: "r1",
        headers: [header("accept", "*/*"), header("content-length", "11")],
        body: { type: "string", value: "héllo body" },
      },
    ]);
  });

  it("the content-length of a new body replaces one in the headers you pass, whatever its case", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", (route) =>
      route.continue({ postData: "12345", headers: { ...route.request().headers, "Content-Length": "999", "x-a": "1" } }),
    );
    blocked("r1", "https://example.test/x", { method: "POST", headers: [header("Content-Length", "4")] });
    await tick(20);
    assert.deepEqual(commands("network.continueRequest")[0].headers, [header("x-a", "1"), header("content-length", "5")]);
  });

  it("continue() sends a Buffer as base64, counted in bytes", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", (route) => route.continue({ postData: Buffer.from([1, 2, 3, 255]) }));
    blocked("r1", "https://example.test/x", { method: "POST" });
    await tick(20);
    const sent = commands("network.continueRequest")[0];
    assert.deepEqual(sent.body, { type: "base64", value: Buffer.from([1, 2, 3, 255]).toString("base64") });
    assert.deepEqual(sent.headers.find((h: any) => h.name === "content-length"), header("content-length", "4"));
  });

  it("abort() fails the request", async () => {
    const { router, blocked, commands } = await setup();
    await router.route(/\.png$/, (route) => route.abort());
    blocked("r1", "https://example.test/a.png");
    await tick(20);
    assert.deepEqual(commands("network.failRequest"), [{ request: "r1" }]);
  });
});

describe("every blocked request is resolved exactly once", () => {
  it("a second resolution throws", async () => {
    const { router, blocked, commands } = await setup();
    const outcomes: string[] = [];
    await router.route("**", async (route) => {
      await route.fulfill({});
      for (const second of [() => route.continue(), () => route.abort(), () => route.fulfill({}), () => route.fallback()]) {
        outcomes.push(await second().then(() => "ok", (err: Error) => err.message));
      }
    });
    blocked("r1", "https://example.test/x");
    await tick(30);
    assert.deepEqual(outcomes, Array(4).fill("route already handled"));
    assert.equal(commands("network.provideResponse").length, 1);
  });

  it("a handler that throws fails the request and the error is kept", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", () => {
      throw new Error("handler bug");
    });
    blocked("r1", "https://example.test/x");
    await tick(30);
    assert.deepEqual(commands("network.failRequest"), [{ request: "r1" }]);
    assert.equal(router.errors.length, 1);
    assert.match(router.errors[0]!.message, /route handler for https:\/\/example\.test\/x threw: handler bug/);
    assert.ok(error.mock.callCount() >= 1);
  });

  it("a handler that throws after answering keeps the answer and reports the error", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", async (route) => {
      await route.fulfill({});
      throw new Error("late bug");
    });
    blocked("r1", "https://example.test/x");
    await tick(30);
    assert.equal(commands("network.failRequest").length, 0);
    assert.equal(router.errors.length, 1);
  });

  it("a handler that returns without answering lets the request continue, with a warning", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", () => {});
    blocked("r1", "https://example.test/x");
    await tick(30);
    assert.deepEqual(commands("network.continueRequest"), [{ request: "r1" }]);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String((warn.mock.calls[0]!.arguments as unknown[])[0]), /did not answer/);
  });

  it("an async handler is awaited: answering later is not overtaken by the default", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", async (route) => {
      await tick(40);
      await route.fulfill({ status: 202 });
    });
    blocked("r1", "https://example.test/x");
    await tick(15);
    assert.equal(commands("network.continueRequest").length, 0, "still waiting for the handler");
    await tick(60);
    assert.equal(commands("network.provideResponse")[0].statusCode, 202);
    assert.equal(commands("network.continueRequest").length, 0);
    assert.equal(warn.mock.callCount(), 0);
  });

  it("a route pending longer than routeTimeout is continued, and the error is logged", async () => {
    const { router, blocked, commands } = await setup({ routeTimeout: 50 });
    await router.route("**", async () => {
      await tick(300); // never answers within the timeout
    });
    blocked("r1", "https://example.test/x");
    await tick(120);
    assert.deepEqual(commands("network.continueRequest"), [{ request: "r1" }]);
    assert.ok(error.mock.callCount() >= 1);
    const [template, , timeout] = error.mock.calls[0]!.arguments as unknown[];
    assert.match(String(template), /did not answer within %dms/);
    assert.equal(timeout, 50);
    await tick(300); // the handler finishing later must not send anything more
    assert.equal(commands("network.continueRequest").length, 1);
  });

  it("the browser refusing an answer reaches the handler as a BiDiError", async () => {
    const gone = Object.assign(new Error("request is gone"), { code: "no such request" });
    const { router, blocked } = await setup({ handlers: { "network.provideResponse": () => gone } });
    let caught: unknown;
    await router.route("**", async (route) => {
      caught = await route.fulfill({}).catch((err: Error) => err);
    });
    blocked("r1", "https://example.test/x");
    await tick(30);
    assert.equal((caught as Error).name, "BiDiError");
    assert.equal((caught as { code: string }).code, "no such request");
  });
});

describe("removing routes", () => {
  it("unroute removes the route; the last one takes the intercept and the listener with it", async () => {
    const { ws, router, commands, blocked } = await setup();
    await router.route("**/a", () => {});
    await router.unroute("**/a");
    assert.deepEqual(commands("network.removeIntercept"), [{ intercept: "i1" }]);
    await tick(10);
    assert.ok(ws.sent.some((m) => m.method === "session.unsubscribe"));
    const before = ws.sent.length;
    blocked("r1", "https://e.test/a");
    await tick(20);
    assert.equal(ws.sent.length, before);
  });

  it("unroute by pattern and handler removes only that pair", async () => {
    const { router, blocked, commands } = await setup();
    const first = () => {};
    const second = (route: Route) => route.abort();
    await router.route("**/a", first);
    await router.route("**/a", second);
    await router.unroute("**/a", second);
    blocked("r1", "https://e.test/a");
    await tick(30);
    assert.equal(commands("network.failRequest").length, 0);
    assert.equal(commands("network.removeIntercept").length, 0, "one route is left");
  });

  it("unroute without a handler removes every route for that pattern", async () => {
    const { router, blocked, commands } = await setup();
    await router.route(/a/, () => {});
    await router.route(/a/, () => {});
    await router.route("**/b", () => {});
    await router.unroute(/a/);
    blocked("r1", "https://e.test/b");
    await tick(30);
    assert.equal(commands("network.continueRequest").length, 1, "the b route is still here (it did not answer, so the request continues)");
    assert.equal(commands("network.removeIntercept").length, 0);
  });

  it("removing a route continues the requests it still holds", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**/slow", async () => {
      await tick(500);
    });
    blocked("r1", "https://e.test/slow");
    await tick(20);
    await router.unroute("**/slow");
    assert.deepEqual(commands("network.continueRequest"), [{ request: "r1" }]);
  });

  it("unrouteAll removes everything, and a new route starts again", async () => {
    const { router, commands } = await setup();
    await router.route("**/a", () => {});
    await router.route(/b/, () => {});
    await router.unrouteAll();
    assert.equal(commands("network.removeIntercept").length, 1);
    await router.route("**/c", () => {});
    assert.equal(commands("network.addIntercept").length, 2);
  });

  it("dispose continues pending requests, removes the intercept and stops listening; it is idempotent", async () => {
    const { ws, router, blocked, commands } = await setup();
    await router.route("**", async () => {
      await tick(500);
    });
    blocked("r1", "https://e.test/x");
    await tick(20);
    await router.dispose();
    assert.deepEqual(commands("network.continueRequest"), [{ request: "r1" }]);
    assert.equal(commands("network.removeIntercept").length, 1);
    const before = ws.sent.length;
    blocked("r2", "https://e.test/y");
    await tick(20);
    assert.equal(ws.sent.length, before);
    await assert.doesNotReject(router.dispose());
    assert.equal(commands("network.removeIntercept").length, 1);
  });

  it("route() after dispose is refused", async () => {
    const { router } = await setup();
    await router.dispose();
    await assert.rejects(router.route("**", () => {}), /disposed/);
  });
});
