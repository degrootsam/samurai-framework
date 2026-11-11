import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  installRouterHooks,
  setup,
  error,
  warn,
  header,
} from "../testing/router-setup.js";
import { tick } from "../testing/fake-websocket.js";

installRouterHooks();

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
    await router.route("**", (route) =>
      route.continue({ postData: "héllo body" }),
    );
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

  it("on Chrome a new body goes without a content-length: Chrome sets it, and hangs the request when given one", async () => {
    const { router, blocked, commands } = await setup({ browser: "chrome" });
    await router.route("**", (route) =>
      route.continue({ postData: "héllo body" }),
    );
    blocked("r1", "https://example.test/x", {
      method: "POST",
      headers: [header("Accept", "*/*"), header("Content-Length", "4")],
    });
    await tick(20);
    assert.deepEqual(commands("network.continueRequest"), [
      {
        request: "r1",
        headers: [header("accept", "*/*")],
        body: { type: "string", value: "héllo body" },
      },
    ]);
  });

  it("the content-length of a new body replaces one in the headers you pass, whatever its case", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", (route) =>
      route.continue({
        postData: "12345",
        headers: {
          ...route.request().headers,
          "Content-Length": "999",
          "x-a": "1",
        },
      }),
    );
    blocked("r1", "https://example.test/x", {
      method: "POST",
      headers: [header("Content-Length", "4")],
    });
    await tick(20);
    assert.deepEqual(commands("network.continueRequest")[0].headers, [
      header("x-a", "1"),
      header("content-length", "5"),
    ]);
  });

  it("continue() sends a Buffer as base64, counted in bytes", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", (route) =>
      route.continue({ postData: Buffer.from([1, 2, 3, 255]) }),
    );
    blocked("r1", "https://example.test/x", { method: "POST" });
    await tick(20);
    const sent = commands("network.continueRequest")[0];
    assert.deepEqual(sent.body, {
      type: "base64",
      value: Buffer.from([1, 2, 3, 255]).toString("base64"),
    });
    assert.deepEqual(
      sent.headers.find((h: any) => h.name === "content-length"),
      header("content-length", "4"),
    );
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
      for (const second of [
        () => route.continue(),
        () => route.abort(),
        () => route.fulfill({}),
        () => route.fallback(),
      ]) {
        outcomes.push(
          await second().then(
            () => "ok",
            (err: Error) => err.message,
          ),
        );
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
    assert.match(
      router.errors[0]!.message,
      /route handler for https:\/\/example\.test\/x threw: handler bug/,
    );
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
    assert.match(
      String((warn.mock.calls[0]!.arguments as unknown[])[0]),
      /did not answer/,
    );
  });

  it("an async handler is awaited: answering later is not overtaken by the default", async () => {
    const { router, blocked, commands } = await setup();
    await router.route("**", async (route) => {
      await tick(40);
      await route.fulfill({ status: 202 });
    });
    blocked("r1", "https://example.test/x");
    await tick(15);
    assert.equal(
      commands("network.continueRequest").length,
      0,
      "still waiting for the handler",
    );
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
    const gone = Object.assign(new Error("request is gone"), {
      code: "no such request",
    });
    const { router, blocked } = await setup({
      handlers: { "network.provideResponse": () => gone },
    });
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
