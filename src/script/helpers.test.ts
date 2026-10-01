import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoReply, FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import {
  CALL_PROBE,
  HELPER_SANDBOX,
  HELPERS_MISSING,
  HELPERS_SOURCE,
  HelperRealm,
} from "./helpers.js";

const ok = { type: "success", realm: "r", result: { type: "undefined" } };

function setup(overrides: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  const stop = autoReply(ws, {
    "script.addPreloadScript": () => ({ script: "helpers-1" }),
    "browsingContext.getTree": () => ({ contexts: [{ context: "top", parent: null, children: [] }] }),
    "script.callFunction": () => ok,
    ...overrides,
  });
  const count = (method: string) => ws.sent.filter((m) => m.method === method).length;
  return { ws, connector, stop, count, realm: new HelperRealm(connector, "top") };
}

describe("helper source", () => {
  it("compiles and installs probeElement on the global", () => {
    const fakeGlobal: Record<string, any> = {};
    new Function("globalThis", `(${HELPERS_SOURCE})()`)(fakeGlobal);
    assert.equal(typeof fakeGlobal.__samurai.probeElement, "function");
  });

  it("the call wrapper forwards to probeElement, or answers with the missing marker", () => {
    const wrapper = (globalScope: object) =>
      new Function("globalThis", `return (${CALL_PROBE})`)(globalScope) as (...args: unknown[]) => unknown;
    const probeElement = (xpath: string, options: unknown) => ({ xpath, options });
    assert.deepEqual(wrapper({ __samurai: { probeElement } })("//a", { scroll: true }), {
      xpath: "//a",
      options: { scroll: true },
    });
    assert.equal(wrapper({})("//a", {}), HELPERS_MISSING);
  });

  it("uses the samurai sandbox", () => {
    assert.equal(HELPER_SANDBOX, "samurai");
  });
});

describe("HelperRealm", () => {
  it("registers once for the page context and runs in the sandbox", async () => {
    const { ws, realm, stop } = setup();
    await realm.ensureInstalled();
    assert.deepEqual(ws.sent[0]!.params, {
      functionDeclaration: HELPERS_SOURCE,
      contexts: ["top"],
      sandbox: "samurai",
    });
    stop();
  });

  it("concurrent and repeated ensureInstalled share one registration", async () => {
    const { realm, count, stop } = setup();
    await Promise.all([realm.ensureInstalled(), realm.ensureInstalled()]);
    await realm.ensureInstalled();
    assert.equal(count("script.addPreloadScript"), 1);
    stop();
  });

  it("a failed install can be retried", async () => {
    let attempts = 0;
    const { realm, count, stop } = setup({
      "script.addPreloadScript": () => (++attempts === 1 ? new Error("first fails") : { script: "helpers-1" }),
    });
    await assert.rejects(realm.ensureInstalled());
    await realm.ensureInstalled();
    assert.equal(count("script.addPreloadScript"), 2);
    stop();
  });

  it("reinstall runs the helpers in the current contexts without registering again", async () => {
    const { ws, realm, count, stop } = setup();
    await realm.ensureInstalled();
    const before = count("script.addPreloadScript");
    await realm.reinstall();
    assert.equal(count("script.addPreloadScript"), before);
    const last = ws.sent.filter((m) => m.method === "script.callFunction").pop()!.params as any;
    assert.equal(last.functionDeclaration, HELPERS_SOURCE);
    assert.deepEqual(last.target, { context: "top", sandbox: "samurai" });
    stop();
  });

  it("reinstall before the first install installs first", async () => {
    const { realm, count, stop } = setup();
    await realm.reinstall();
    assert.equal(count("script.addPreloadScript"), 1);
    stop();
  });

  it("dispose removes the registration", async () => {
    const { realm, count, stop } = setup({ "script.removePreloadScript": () => ({}) });
    await realm.ensureInstalled();
    await realm.dispose();
    await tick(5);
    assert.equal(count("script.removePreloadScript"), 1);
    stop();
  });

  it("dispose without an install sends nothing", async () => {
    const { realm, count, stop } = setup();
    await realm.dispose();
    assert.equal(count("script.removePreloadScript"), 0);
    stop();
  });
});
