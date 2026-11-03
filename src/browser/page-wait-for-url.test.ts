import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FakeWebSocket, makeConnector } from "../testing/fake-websocket.js";
import { UrlTimeoutError } from "./navigation-error.js";
import { PageNavigation } from "./page-navigation.js";
import { PageConfig } from "./page-settings.js";

function setup(urls: Array<string | Error>, baseURL?: string) {
  let read = 0;
  const calls: string[] = [];
  const nav = new PageNavigation(makeConnector(new FakeWebSocket()), "ctx-1", {
    config: new PageConfig({
      navigation: { timeout: 1000 },
      network: {},
      use: {},
    }),
    documents: {
      waitForState: async (state: string, timeout: number) => {
        calls.push(`wait ${state} ${timeout > 0 ? "t" : "0"}`);
      },
    } as never,
    assertOpen: () => {},
    url: async () => {
      const next = urls[Math.min(read++, urls.length - 1)]!;
      if (next instanceof Error) throw next;
      return next;
    },
    waitForNetworkIdle: async () => void calls.push("idle"),
  });
  nav.setBaseURL(baseURL);
  return { nav, calls, reads: () => read };
}

describe("PageNavigation.waitForURL", () => {
  it("resolves for a string equal to the URL, then waits for the load state", async () => {
    const { nav, calls } = setup(["https://example.test/done"]);
    await nav.waitForURL("https://example.test/done");
    assert.deepEqual(calls, ["wait load t"]);
  });

  it("matches a glob, a RegExp and a function that gets a URL object", async () => {
    const url = "https://example.test/users/7?tab=a";
    await setup([url]).nav.waitForURL("**/users/*?tab=a");
    await setup([url]).nav.waitForURL(/users\/\d+/);
    let seen: URL | undefined;
    await setup([url]).nav.waitForURL((u) => {
      seen = u;
      return u.searchParams.get("tab") === "a";
    });
    assert.ok(seen instanceof URL);
    assert.equal(seen.pathname, "/users/7");
  });

  it("polls until the URL matches", async () => {
    const { nav, reads } = setup([
      "https://example.test/a",
      "https://example.test/a",
      "https://example.test/b",
    ]);
    await nav.waitForURL("**/b", { timeout: 3000 });
    assert.equal(reads(), 3);
  });

  it("keeps polling when the URL cannot be read for a moment", async () => {
    const { nav } = setup([new Error("navigating"), "https://example.test/b"]);
    await nav.waitForURL("**/b", { timeout: 3000 });
  });

  it("resolves a slash-led string against the base URL, like toHaveURL", async () => {
    const { nav } = setup(["https://base.test/done"], "https://base.test");
    await nav.waitForURL("/done");
  });

  it("needs a base URL for a slash-led string", async () => {
    const { nav } = setup(["https://example.test/"]);
    await assert.rejects(
      nav.waitForURL("/x"),
      /waitForURL\(\): "\/x" needs a baseURL/,
    );
  });

  it("waits for the load state it is given", async () => {
    const one = setup(["https://example.test/"]);
    await one.nav.waitForURL(/test/, { waitUntil: "domcontentloaded" });
    assert.deepEqual(one.calls, ["wait domcontentloaded t"]);
    const two = setup(["https://example.test/"]);
    await two.nav.waitForURL(/test/, { waitUntil: "networkidle" });
    assert.deepEqual(two.calls, ["wait load t", "idle"]);
  });

  it("times out with the pattern and the last URL in the message", async () => {
    const { nav } = setup(["https://example.test/stuck"]);
    await assert.rejects(
      nav.waitForURL("**/never", { timeout: 250 }),
      (err: Error) => {
        assert.ok(err instanceof UrlTimeoutError);
        assert.match(err.message, /waitForURL\(\)/);
        assert.match(err.message, /\*\*\/never/);
        assert.match(err.message, /within 250ms/);
        assert.match(err.message, /https:\/\/example\.test\/stuck/);
        return true;
      },
    );
  });

  it("a RegExp or function pattern is described in the timeout message too", async () => {
    await assert.rejects(
      setup(["https://example.test/"]).nav.waitForURL(/never/, {
        timeout: 120,
      }),
      /\/never\//,
    );
    await assert.rejects(
      setup(["https://example.test/"]).nav.waitForURL(() => false, {
        timeout: 120,
      }),
      /predicate/,
    );
  });
});
