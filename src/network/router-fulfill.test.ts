import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installRouterHooks, setup, header } from "../testing/router-setup.js";
import { tick } from "../testing/fake-websocket.js";
import type { Route } from "./router.js";

installRouterHooks();

describe("what a blocked request does", () => {
  it("goes to the matching handler, with the request described", async () => {
    const { router, blocked } = await setup();
    let seen!: Route;
    await router.route("**/api/**", (route) => {
      seen = route;
      return route.continue();
    });
    blocked("r1", "https://example.test/api/users", {
      method: "POST",
      headers: [header("Content-Type", "application/json")],
    });
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
    assert.equal(
      commands("network.failRequest").length +
        commands("network.provideResponse").length,
      0,
    );
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
    assert.equal(
      commands("network.continueRequest").length,
      0,
      "answered once",
    );
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
    assert.deepEqual(sent.headers, [
      header("content-type", "application/json"),
      header("content-length", "10"),
    ]);
  });

  it("a string body is sent as text, its length counted in bytes", async () => {
    const sent = await fulfilled({
      status: 404,
      body: "héllo",
      contentType: "text/plain",
    });
    assert.equal(sent.statusCode, 404);
    assert.equal(sent.reasonPhrase, "Not Found");
    assert.deepEqual(sent.body, { type: "string", value: "héllo" });
    assert.deepEqual(sent.headers, [
      header("content-type", "text/plain"),
      header("content-length", "6"),
    ]);
  });

  it("a Buffer body is sent as base64", async () => {
    const sent = await fulfilled({ body: Buffer.from([0, 1, 2, 255]) });
    assert.deepEqual(sent.body, {
      type: "base64",
      value: Buffer.from([0, 1, 2, 255]).toString("base64"),
    });
    assert.deepEqual(
      sent.headers.find((h: any) => h.name === "content-length"),
      header("content-length", "4"),
    );
  });

  it("your headers win: content-type and content-length are only added when missing, whatever their case", async () => {
    const sent = await fulfilled({
      json: { a: 1 },
      headers: {
        "Content-Type": "application/vnd.api+json",
        "CONTENT-LENGTH": "99",
        "x-mock": "1",
      },
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
      failure = await route
        .fulfill({ json: 1, body: "x" })
        .catch((err: Error) => err);
      await route.abort();
    });
    blocked("r1", "https://example.test/x");
    await tick(30);
    assert.ok(failure instanceof TypeError);
  });
});
