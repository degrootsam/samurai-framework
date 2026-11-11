import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Page from "./page.js";
import { stubConnector } from "../testing/stub-connector.js";
import { resolveRunSettings, setRunSettings } from "../config/run-settings.js";

describe("Page.goto", () => {
  const urls = (sent: Array<{ params: unknown }>) =>
    sent.map(({ params }) => (params as { url: string }).url);

  test("resolves relative URLs against the page's base URL", async () => {
    const { connector, sent } = stubConnector({ type: "undefined" });
    const page = new Page(connector, "ctx");
    page.setBaseURL("https://staging.harbor.shop/shop/");
    await page.goto("/products");
    await page.goto("./cart");
    await page.goto("../account");
    assert.deepEqual(urls(sent), [
      "https://staging.harbor.shop/products",
      "https://staging.harbor.shop/shop/cart",
      "https://staging.harbor.shop/account",
    ]);
  });

  test("keeps absolute URLs and bare hosts like navigateTo", async () => {
    const { connector, sent } = stubConnector({ type: "undefined" });
    const page = new Page(connector, "ctx");
    page.setBaseURL("https://staging.harbor.shop");
    await page.goto("https://other.test/x");
    await page.goto("itmetsam.nl");
    assert.deepEqual(urls(sent), [
      "https://other.test/x",
      "https://itmetsam.nl",
    ]);
  });

  test("uses the active run's base URL when the page has none", async () => {
    setRunSettings(resolveRunSettings({ baseURL: "https://harbor.shop" }));
    try {
      const { connector, sent } = stubConnector({ type: "undefined" });
      await new Page(connector, "ctx").goto("/login");
      assert.deepEqual(urls(sent), ["https://harbor.shop/login"]);
    } finally {
      setRunSettings(undefined);
    }
  });

  test("a relative URL without a base URL throws", async () => {
    const { connector, sent } = stubConnector({ type: "undefined" });
    await assert.rejects(new Page(connector, "ctx").goto("/products"), {
      message:
        'goto(): "/products" needs a baseURL; set one in samurai.config.ts or the environment',
    });
    assert.equal(sent.length, 0);
  });
});
