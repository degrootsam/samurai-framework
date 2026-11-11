import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { failing, setup, stops } from "../testing/browser-context-fixture.js";

afterEach(() => stops.splice(0).forEach((stop) => stop()));

describe("cookies", () => {
  it("addCookies stores each cookie in this context's storage", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await context.addCookies([
      { name: "sid", value: "1", domain: "example.test" },
      {
        name: "pref",
        value: "dark",
        domain: "example.test",
        path: "/app",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        expiry: 1900000000,
      },
    ]);
    assert.deepEqual(commands("storage.setCookie"), [
      {
        cookie: {
          name: "sid",
          value: { type: "string", value: "1" },
          domain: "example.test",
          path: "/",
        },
        partition: { type: "storageKey", userContext: "u1" },
      },
      {
        cookie: {
          name: "pref",
          value: { type: "string", value: "dark" },
          domain: "example.test",
          path: "/app",
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          expiry: 1900000000,
        },
        partition: { type: "storageKey", userContext: "u1" },
      },
    ]);
  });

  it("a url supplies domain, path and secure", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "a",
        value: "1",
        url: "https://shop.example.test/cart/items?x=1",
      },
      { name: "b", value: "2", url: "http://localhost:3000/" },
      {
        name: "c",
        value: "3",
        url: "https://example.test/",
        secure: false,
        path: "/x",
      },
    ]);
    const cookies = commands("storage.setCookie").map((c) => c.cookie);
    assert.deepEqual(cookies[0], {
      name: "a",
      value: { type: "string", value: "1" },
      domain: "shop.example.test",
      path: "/cart/items",
      secure: true,
    });
    assert.deepEqual(cookies[1], {
      name: "b",
      value: { type: "string", value: "2" },
      domain: "localhost",
      path: "/",
      secure: false,
    });
    assert.deepEqual(cookies[2], {
      name: "c",
      value: { type: "string", value: "3" },
      domain: "example.test",
      path: "/x",
      secure: false,
    });
  });

  it("needs a domain or a url, and nothing is stored when one cookie is wrong", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await assert.rejects(
      context.addCookies([
        { name: "ok", value: "1", domain: "example.test" },
        { name: "bad", value: "2" },
      ]),
      /addCookies\(\): cookie "bad" needs a domain or a url/,
    );
    await assert.rejects(
      context.addCookies([{ name: "x", value: "1", url: "not a url" }]),
      TypeError,
    );
    assert.equal(commands("storage.setCookie").length, 0);
  });

  it("the default context's cookies live in the default user context", async () => {
    const { browser, commands } = setup();
    await browser.defaultContext.addCookies([
      { name: "a", value: "1", domain: "example.test" },
    ]);
    assert.deepEqual(commands("storage.setCookie")[0].partition, {
      type: "storageKey",
      userContext: "default",
    });
  });

  it("a cookie the browser refuses is thrown as a BiDiError", async () => {
    const { browser } = setup({
      "storage.setCookie": () => failing("unable to set cookie"),
    });
    const context = await browser.newContext();
    await assert.rejects(
      context.addCookies([{ name: "a", value: "1", domain: "example.test" }]),
      {
        name: "BiDiError",
        code: "unable to set cookie",
      },
    );
  });

  it("cookies() returns plain cookies, decoding values and leaving out what is not set", async () => {
    const { browser, commands } = setup({
      "storage.getCookies": () => ({
        partitionKey: {},
        cookies: [
          {
            name: "sid",
            value: { type: "string", value: "1" },
            domain: "example.test",
            path: "/",
            size: 4,
            httpOnly: false,
            secure: false,
            sameSite: "default",
          },
          {
            name: "bin",
            value: {
              type: "base64",
              value: Buffer.from("héllo").toString("base64"),
            },
            domain: "example.test",
            path: "/a",
            size: 9,
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            expiry: 1900000000,
          },
        ],
      }),
    });
    const context = await browser.newContext();
    const cookies = await context.cookies();
    assert.deepEqual(cookies, [
      {
        name: "sid",
        value: "1",
        domain: "example.test",
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "default",
      },
      {
        name: "bin",
        value: "héllo",
        domain: "example.test",
        path: "/a",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        expiry: 1900000000,
      },
    ]);
    assert.deepEqual(commands("storage.getCookies"), [
      { partition: { type: "storageKey", userContext: "u1" } },
    ]);
  });

  it("cookies(filter) filters by name, domain and path", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await context.cookies({ name: "sid", domain: "example.test", path: "/" });
    await context.cookies({ name: "only-name" });
    assert.deepEqual(commands("storage.getCookies"), [
      {
        filter: { name: "sid", domain: "example.test", path: "/" },
        partition: { type: "storageKey", userContext: "u1" },
      },
      {
        filter: { name: "only-name" },
        partition: { type: "storageKey", userContext: "u1" },
      },
    ]);
  });

  it("clearCookies deletes all, or those the filter names", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await context.clearCookies();
    await context.clearCookies({ name: "sid" });
    assert.deepEqual(commands("storage.deleteCookies"), [
      { partition: { type: "storageKey", userContext: "u1" } },
      {
        filter: { name: "sid" },
        partition: { type: "storageKey", userContext: "u1" },
      },
    ]);
  });

  it("a page reaches its context's cookies through page.context()", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page
      .context()
      .addCookies([{ name: "a", value: "1", domain: "example.test" }]);
    assert.equal(commands("storage.setCookie")[0].partition.userContext, "u1");
  });
});
