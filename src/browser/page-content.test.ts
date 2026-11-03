import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autoReply,
  FakeWebSocket,
  makeConnector,
} from "../testing/fake-websocket.js";
import { remote, stubConnector } from "../testing/stub-connector.js";
import { LoadStateTimeoutError } from "./navigation-error.js";
import { readContent, writeContent } from "./page-content.js";
import { PageNavigation } from "./page-navigation.js";
import { PageConfig } from "./page-settings.js";
import Page from "./page.js";

/** The sources compile as the function bodies they are sent as */
function assertCompiles(source: string) {
  assert.doesNotThrow(() => new Function(`return (${source});`), source);
}

describe("readContent", () => {
  it("reads the doctype and the document element in the page and returns the string", async () => {
    const { connector, calls } = stubConnector(
      remote("<!DOCTYPE html><html></html>"),
    );
    assert.equal(
      await readContent(connector, "ctx"),
      "<!DOCTYPE html><html></html>",
    );
    assert.match(calls[0]!.functionDeclaration, /doctype/);
    assert.match(calls[0]!.functionDeclaration, /outerHTML/);
    assertCompiles(calls[0]!.functionDeclaration);
  });

  it("is on the page", async () => {
    const { connector } = stubConnector(remote("<html></html>"));
    assert.equal(await new Page(connector, "ctx").content(), "<html></html>");
  });
});

describe("writeContent", () => {
  it("replaces the document with document.open, write and close, and says whether the state was reached", async () => {
    const { connector, calls } = stubConnector({
      type: "boolean",
      value: true,
    });
    assert.equal(
      await writeContent(connector, "ctx", "<p>x</p>", "load", 1234),
      true,
    );
    const { functionDeclaration, args } = calls[0]!;
    for (const part of [
      "document.open()",
      "document.write(",
      "document.close()",
    ]) {
      assert.ok(functionDeclaration.includes(part), part);
    }
    assert.deepEqual(args, ["<p>x</p>", "load", 1234]);
    assertCompiles(functionDeclaration);
  });

  it("reports false when the page did not get there in time", async () => {
    const { connector } = stubConnector({ type: "boolean", value: false });
    assert.equal(
      await writeContent(connector, "ctx", "", "domcontentloaded", 10),
      false,
    );
  });
});

describe("PageNavigation.setContent", () => {
  function setup(reached = true) {
    const ws = new FakeWebSocket();
    const connector = makeConnector(ws);
    const stop = autoReply(ws, {
      "script.callFunction": () => ({
        type: "success",
        realm: "r",
        result: { type: "boolean", value: reached },
      }),
    });
    const idle: number[] = [];
    const nav = new PageNavigation(connector, "ctx-1", {
      config: new PageConfig({
        navigation: { timeout: 777 },
        network: {},
        use: {},
      }),
      documents: {} as never,
      assertOpen: () => {},
      url: async () => "about:blank",
      waitForNetworkIdle: async ({ timeout }) => void idle.push(timeout),
    });
    const calls = () =>
      ws.sent
        .filter((m) => m.method === "script.callFunction")
        .map((m) => m.params as any);
    return { nav, calls, idle, stop };
  }

  it("waits for the load event by default, within the navigation timeout", async () => {
    const { nav, calls, stop } = setup();
    await nav.setContent("<p>hi</p>");
    assert.deepEqual(
      calls()[0].arguments.map((a: any) => a.value),
      ["<p>hi</p>", "load", 777],
    );
    assert.equal(calls()[0].awaitPromise, true);
    stop();
  });

  it("takes waitUntil and timeout; networkidle is load plus a quiet network", async () => {
    const { nav, calls, idle, stop } = setup();
    await nav.setContent("", { waitUntil: "domcontentloaded", timeout: 50 });
    assert.deepEqual(
      calls()[0]
        .arguments.map((a: any) => a.value)
        .slice(1),
      ["domcontentloaded", 50],
    );
    assert.deepEqual(idle, []);
    await nav.setContent("", { waitUntil: "networkidle", timeout: 60 });
    assert.equal(calls()[1].arguments[1].value, "load");
    assert.deepEqual(idle, [60]);
    stop();
  });

  it("fails like waitForLoadState when the page did not get there", async () => {
    const { nav, stop } = setup(false);
    await assert.rejects(nav.setContent("", { timeout: 20 }), (err: Error) => {
      assert.ok(err instanceof LoadStateTimeoutError);
      assert.match(err.message, /within 20ms/);
      return true;
    });
    stop();
  });
});
