import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autoReply,
  FakeWebSocket,
  makeConnector,
} from "../testing/fake-websocket.js";
import { UnsupportedOperationError } from "../transport/unsupported.js";
import { WaitTimeoutError } from "../wait/wait-until.js";
import { LoadStateTimeoutError, NavigationError } from "./navigation-error.js";
import { PageNavigation, type NavigationDeps } from "./page-navigation.js";
import { PageConfig } from "./page-settings.js";

const failing = (code: string, message = "nope") =>
  Object.assign(new Error(message), { code });

function setup(
  handlers: Record<string, (params: any) => object | Error> = {},
  over: Partial<NavigationDeps> = {},
) {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  const stop = autoReply(ws, handlers);
  const calls: string[] = [];
  const documents = {
    watch: async () => void calls.push("watch"),
    progressOf: (navigation: string) => {
      calls.push(`progress ${navigation}`);
      return { domContentLoaded: false, load: false };
    },
    waitForState: async (state: string, timeout: number, nav?: string) => {
      calls.push(`wait ${state} ${timeout} ${nav ?? "-"}`);
    },
  };
  const nav = new PageNavigation(connector, "ctx-1", {
    config: new PageConfig({ navigation: { timeout: 1000 }, network: {} }),
    documents: documents as never,
    assertOpen: () => {},
    url: async () => "https://example.test/now",
    waitForNetworkIdle: async ({ timeout }) =>
      void calls.push(`idle ${timeout}`),
    ...over,
  });
  const sent = (method: string) =>
    ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
  return { nav, calls, sent, stop };
}

const navigate = () => ({ navigation: "nav-1", url: "https://example.test/" });

describe("PageNavigation.navigateTo", () => {
  it("adds https:// to a URL without a scheme, and http:// when asked", async () => {
    const { nav, sent, stop } = setup({
      "browsingContext.navigate": navigate,
    });
    await nav.navigateTo("example.test");
    await nav.navigateTo("localhost:3000", { protocol: "http" });
    await nav.navigateTo("mailto:a@b.test");
    assert.deepEqual(
      sent("browsingContext.navigate").map((p) => p.url),
      ["https://example.test", "http://localhost:3000", "mailto:a@b.test"],
    );
    stop();
  });

  it("takes the positional wait and protocol, and the config's timeout", async () => {
    const { nav, sent, stop } = setup({
      "browsingContext.navigate": navigate,
    });
    await nav.navigateTo("example.test", "interactive", "http");
    assert.deepEqual(sent("browsingContext.navigate"), [
      { context: "ctx-1", url: "http://example.test", wait: "interactive" },
    ]);
    stop();
  });

  it("watches a navigation that does not wait for the load, and remembers it for waitForLoadState", async () => {
    const { nav, calls, stop } = setup({
      "browsingContext.navigate": navigate,
    });
    await nav.navigateTo("example.test", { wait: "none" });
    assert.deepEqual(calls.slice(0, 2), ["watch", "progress nav-1"]);
    await nav.waitForLoadState("load", { timeout: 50 });
    assert.equal(calls[calls.length - 1], "wait load 50 nav-1");
    stop();
  });

  it("does not watch a navigation that waits for the load", async () => {
    const { nav, calls, stop } = setup({
      "browsingContext.navigate": navigate,
    });
    await nav.navigateTo("example.test");
    assert.deepEqual(calls, []);
    stop();
  });

  it("turns a BiDi failure into a NavigationError that names the URL", async () => {
    const { nav, stop } = setup({
      "browsingContext.navigate": () => failing("unknown error", "net broke"),
    });
    await assert.rejects(nav.navigateTo("example.test"), (err: unknown) => {
      assert.ok(err instanceof NavigationError);
      assert.match(
        err.message,
        /navigateTo\(\): https:\/\/example.test failed: .*net broke/,
      );
      return true;
    });
    stop();
  });

  it("says timeout after N ms when the command ran out of time", async () => {
    const { nav, stop } = setup({
      "browsingContext.navigate": () => failing("timeout"),
    });
    await assert.rejects(
      nav.navigateTo("example.test", { timeout: 40 }),
      /navigateTo\(\): https:\/\/example.test failed: timeout after 40ms/,
    );
    stop();
  });

  it("checks that the page is open", async () => {
    const { nav, stop } = setup(
      {},
      {
        assertOpen: () => {
          throw new Error("page closed");
        },
      },
    );
    await assert.rejects(nav.navigateTo("example.test"), /page closed/);
    stop();
  });
});

describe("PageNavigation.goto", () => {
  it("leaves an absolute URL to navigateTo", async () => {
    const { nav, sent, stop } = setup({
      "browsingContext.navigate": navigate,
    });
    await nav.goto("https://other.test/x");
    assert.equal(
      sent("browsingContext.navigate")[0].url,
      "https://other.test/x",
    );
    stop();
  });

  it("resolves a relative URL against the base URL", async () => {
    const { nav, sent, stop } = setup({
      "browsingContext.navigate": navigate,
    });
    nav.setBaseURL("https://shop.test/app/");
    await nav.goto("/products");
    await nav.goto("./cart");
    assert.deepEqual(
      sent("browsingContext.navigate").map((p) => p.url),
      ["https://shop.test/products", "https://shop.test/app/cart"],
    );
    stop();
  });

  it("asks for a base URL when there is none", async () => {
    const { nav, stop } = setup();
    nav.setBaseURL(undefined);
    await assert.rejects(
      nav.goto("/products"),
      /goto\(\): "\/products" needs a baseURL/,
    );
    stop();
  });
});

describe("PageNavigation.reload", () => {
  it("reloads this context, asking for ignoreCache only when told to", async () => {
    const { nav, sent, stop } = setup({
      "browsingContext.reload": () => ({ navigation: null, url: "u" }),
    });
    await nav.reload();
    await nav.reload({ ignoreCache: true, wait: "interactive" });
    assert.deepEqual(sent("browsingContext.reload"), [
      { context: "ctx-1", wait: "complete" },
      { context: "ctx-1", wait: "interactive", ignoreCache: true },
    ]);
    stop();
  });

  it("reports an unsupported ignoreCache as UnsupportedOperationError", async () => {
    const { nav, stop } = setup({
      "browsingContext.reload": () => failing("unsupported operation"),
    });
    await assert.rejects(nav.reload({ ignoreCache: true }), (err: unknown) => {
      assert.ok(err instanceof UnsupportedOperationError);
      assert.match(err.message, /reload\(\): ignoreCache is not supported/);
      return true;
    });
    stop();
  });

  it("names the page by its current URL when the reload fails", async () => {
    const { nav, stop } = setup({
      "browsingContext.reload": () => failing("unknown error", "gone"),
    });
    await assert.rejects(
      nav.reload(),
      /reload\(\): https:\/\/example.test\/now failed: .*gone/,
    );
    stop();
  });
});

describe("PageNavigation.waitForLoadState", () => {
  it("waits for the document with the config's timeout; domcontentloaded waits for that state, the rest for load", async () => {
    const { nav, calls, stop } = setup();
    await nav.waitForLoadState();
    await nav.waitForLoadState("domcontentloaded", { timeout: 20 });
    assert.deepEqual(calls, ["wait load 1000 -", "wait domcontentloaded 20 -"]);
    stop();
  });

  it("networkidle waits for the document, then for a quiet network", async () => {
    const { nav, calls, stop } = setup();
    await nav.waitForLoadState("networkidle", { timeout: 70 });
    assert.deepEqual(calls, ["wait load 70 -", "idle 70"]);
    stop();
  });

  it("turns a timeout into a LoadStateTimeoutError", async () => {
    const { nav, stop } = setup(
      {},
      {
        documents: {
          waitForState: async () => {
            throw new WaitTimeoutError(30, undefined);
          },
        } as never,
      },
    );
    await assert.rejects(
      nav.waitForLoadState("load", { timeout: 30 }),
      (err) => {
        assert.ok(err instanceof LoadStateTimeoutError);
        assert.match(
          err.message,
          /waitForLoadState\("load"\) did not finish within 30ms/,
        );
        return true;
      },
    );
    stop();
  });

  it("lets other failures through unchanged", async () => {
    const boom = new Error("boom");
    const { nav, stop } = setup(
      {},
      {
        documents: {
          waitForState: async () => {
            throw boom;
          },
        } as never,
      },
    );
    await assert.rejects(nav.waitForLoadState(), (err) => err === boom);
    stop();
  });
});
