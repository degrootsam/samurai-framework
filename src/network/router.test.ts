import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installRouterHooks, setup } from "../testing/router-setup.js";
import { tick } from "../testing/fake-websocket.js";
import type { Route } from "./router.js";

installRouterHooks();

describe("registering routes", () => {
  it("sends one intercept, for this page, however many routes", async () => {
    const { router, commands } = await setup();
    await router.route("**/api/**", () => {});
    await router.route(/\.png$/, () => {});
    assert.deepEqual(commands("network.addIntercept"), [
      { phases: ["beforeRequestSent"], contexts: ["top"] },
    ]);
  });

  it("concurrent route() calls share one intercept", async () => {
    const { router, commands } = await setup();
    await Promise.all([
      router.route("**/a", () => {}),
      router.route("**/b", () => {}),
      router.route(/c/, () => {}),
    ]);
    assert.equal(commands("network.addIntercept").length, 1);
  });

  it("with only exact URLs the browser is asked to block just those", async () => {
    const { router, commands } = await setup();
    await router.route("https://example.test/api/users", () => {});
    await router.route("https://example.test/api/items?page=1", () => {});
    assert.deepEqual(
      commands("network.addIntercept").map((c) => c.urlPatterns),
      [
        [{ type: "string", pattern: "https://example.test/api/users" }],
        [
          { type: "string", pattern: "https://example.test/api/users" },
          { type: "string", pattern: "https://example.test/api/items?page=1" },
        ],
      ],
    );
  });

  it("adding a glob widens the intercept: the new one is added before the old one is removed", async () => {
    const { ws, router } = await setup();
    await router.route("https://example.test/api/users", () => {});
    await router.route("**/images/*", () => {});
    const order = ws.sent
      .filter(
        (m) =>
          m.method === "network.addIntercept" ||
          m.method === "network.removeIntercept",
      )
      .map((m) => m.method);
    assert.deepEqual(order, [
      "network.addIntercept",
      "network.addIntercept",
      "network.removeIntercept",
    ]);
    assert.equal(
      (
        ws.sent.filter((m) => m.method === "network.addIntercept")[1]!
          .params as any
      ).urlPatterns,
      undefined,
    );
    assert.deepEqual(
      ws.sent.find((m) => m.method === "network.removeIntercept")!.params,
      { intercept: "i1" },
    );
  });

  it("an exact string that is not in URL-normal form is not handed to the browser as a pattern", async () => {
    const { router, commands } = await setup();
    await router.route("https://example.test", () => {}); // the browser would read it as https://example.test/
    assert.equal(commands("network.addIntercept")[0].urlPatterns, undefined);
  });

  it("falls back to blocking everything when the browser rejects url patterns, and remembers", async () => {
    const rejected = Object.assign(new Error("urlPatterns not supported"), {
      code: "invalid argument",
    });
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
    const withPatterns = commands("network.addIntercept").filter(
      (c) => c.urlPatterns,
    );
    assert.equal(withPatterns.length, 1, "asked once, then remembered");
  });
});

describe("removing routes", () => {
  it("unroute removes the route; the last one takes the intercept and the listener with it", async () => {
    const { ws, router, commands, blocked } = await setup();
    await router.route("**/a", () => {});
    await router.unroute("**/a");
    assert.deepEqual(commands("network.removeIntercept"), [
      { intercept: "i1" },
    ]);
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
    assert.equal(
      commands("network.removeIntercept").length,
      0,
      "one route is left",
    );
  });

  it("unroute without a handler removes every route for that pattern", async () => {
    const { router, blocked, commands } = await setup();
    await router.route(/a/, () => {});
    await router.route(/a/, () => {});
    await router.route("**/b", () => {});
    await router.unroute(/a/);
    blocked("r1", "https://e.test/b");
    await tick(30);
    assert.equal(
      commands("network.continueRequest").length,
      1,
      "the b route is still here (it did not answer, so the request continues)",
    );
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
    await assert.rejects(
      router.route("**", () => {}),
      /disposed/,
    );
  });
});
