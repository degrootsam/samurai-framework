import assert from "node:assert/strict";
import EventEmitter from "node:events";
import { afterEach, describe, it } from "node:test";
import { autoReply, FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { Browser } from "./browser.js";

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

const failing = (code: string, message = "nope") => Object.assign(new Error(message), { code });

function setup(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  let contexts = 0;
  let tabs = 0;
  stops.push(
    autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: [] }),
      "browser.createUserContext": () => ({ userContext: `u${++contexts}` }),
      "browser.removeUserContext": () => ({}),
      "browsingContext.create": (params) => ({ context: `tab-${++tabs}`, userContext: params.userContext ?? "default" }),
      "storage.setCookie": () => ({ partitionKey: {} }),
      "storage.getCookies": () => ({ cookies: [], partitionKey: {} }),
      "storage.deleteCookies": () => ({ partitionKey: {} }),
      ...handlers,
    }),
  );
  const proc = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill() {
      queueMicrotask(() => proc.emit("exit"));
    },
  });
  const browser = new Browser({ browserProc: proc as never, biDiConnector: connector });
  const commands = (method: string) => ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
  return { ws, browser, commands };
}

describe("Browser.newContext", () => {
  it("creates a user context and returns a BrowserContext with its id", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    assert.equal(context.id, "u1");
    assert.equal(context.isDefault, false);
    assert.deepEqual(commands("browser.createUserContext"), [{}]);
  });

  it("passes its options on", async () => {
    const { browser, commands } = setup();
    await browser.newContext({ acceptInsecureCerts: true, unhandledPromptBehavior: { default: "dismiss" } });
    assert.deepEqual(commands("browser.createUserContext"), [
      { acceptInsecureCerts: true, unhandledPromptBehavior: { default: "dismiss" } },
    ]);
  });

  it("knows the default context, and lists the ones this browser created", async () => {
    const { browser } = setup();
    assert.equal(browser.defaultContext.id, "default");
    assert.equal(browser.defaultContext.isDefault, true);
    assert.deepEqual(browser.contexts().map((c) => c.id), ["default"]);
    const a = await browser.newContext();
    const b = await browser.newContext();
    assert.deepEqual(browser.contexts().map((c) => c.id), ["default", "u1", "u2"]);
    await a.close();
    assert.deepEqual(browser.contexts(), [browser.defaultContext, b]);
  });
});

describe("BrowserContext.newPage", () => {
  it("opens a tab in the user context and binds the page to it", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    const page = await context.newPage();
    assert.deepEqual(commands("browsingContext.create"), [{ type: "tab", userContext: "u1" }]);
    assert.equal(page.contextId, "tab-1");
    assert.equal(page.context(), context);
    assert.deepEqual(context.pages(), [page]);
  });

  it("the default context opens tabs without naming a user context", async () => {
    const { browser, commands } = setup();
    const page = await browser.defaultContext.newPage();
    assert.deepEqual(commands("browsingContext.create"), [{ type: "tab" }]);
    assert.equal(page.context(), browser.defaultContext);
  });

  it("Browser.newPage puts its page in the context it was created in", async () => {
    const { browser } = setup();
    const context = await browser.newContext();
    const inContext = await browser.newPage({ type: "tab", userContext: context.id });
    const inDefault = await browser.newPage({ type: "tab" });
    assert.equal(inContext.context(), context);
    assert.equal(inDefault.context(), browser.defaultContext);
  });

  it("a page that closed is no longer listed", async () => {
    const { browser } = setup({ "browsingContext.close": () => ({}) });
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();
    await first.close();
    assert.deepEqual(context.pages(), [second]);
  });

  it("a page built by hand has no context", async () => {
    const { browser } = setup();
    const { default: Page } = await import("./page.js");
    const stray = new Page((browser as any).biDiConnector, "x");
    assert.throws(() => stray.context(), /no browser context/);
  });
});

describe("cookies", () => {
  it("addCookies stores each cookie in this context's storage", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await context.addCookies([
      { name: "sid", value: "1", domain: "example.test" },
      { name: "pref", value: "dark", domain: "example.test", path: "/app", httpOnly: true, secure: true, sameSite: "lax", expiry: 1900000000 },
    ]);
    assert.deepEqual(commands("storage.setCookie"), [
      {
        cookie: { name: "sid", value: { type: "string", value: "1" }, domain: "example.test", path: "/" },
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
      { name: "a", value: "1", url: "https://shop.example.test/cart/items?x=1" },
      { name: "b", value: "2", url: "http://localhost:3000/" },
      { name: "c", value: "3", url: "https://example.test/", secure: false, path: "/x" },
    ]);
    const cookies = commands("storage.setCookie").map((c) => c.cookie);
    assert.deepEqual(cookies[0], { name: "a", value: { type: "string", value: "1" }, domain: "shop.example.test", path: "/cart/items", secure: true });
    assert.deepEqual(cookies[1], { name: "b", value: { type: "string", value: "2" }, domain: "localhost", path: "/", secure: false });
    assert.deepEqual(cookies[2], { name: "c", value: { type: "string", value: "3" }, domain: "example.test", path: "/x", secure: false });
  });

  it("needs a domain or a url, and nothing is stored when one cookie is wrong", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await assert.rejects(
      context.addCookies([{ name: "ok", value: "1", domain: "example.test" }, { name: "bad", value: "2" }]),
      /cookie "bad" needs a domain or a url/,
    );
    await assert.rejects(context.addCookies([{ name: "x", value: "1", url: "not a url" }]), TypeError);
    assert.equal(commands("storage.setCookie").length, 0);
  });

  it("the default context's cookies live in the default user context", async () => {
    const { browser, commands } = setup();
    await browser.defaultContext.addCookies([{ name: "a", value: "1", domain: "example.test" }]);
    assert.deepEqual(commands("storage.setCookie")[0].partition, { type: "storageKey", userContext: "default" });
  });

  it("a cookie the browser refuses is thrown as a BiDiError", async () => {
    const { browser } = setup({ "storage.setCookie": () => failing("unable to set cookie") });
    const context = await browser.newContext();
    await assert.rejects(context.addCookies([{ name: "a", value: "1", domain: "example.test" }]), {
      name: "BiDiError",
      code: "unable to set cookie",
    });
  });

  it("cookies() returns plain cookies, decoding values and leaving out what is not set", async () => {
    const { browser, commands } = setup({
      "storage.getCookies": () => ({
        partitionKey: {},
        cookies: [
          { name: "sid", value: { type: "string", value: "1" }, domain: "example.test", path: "/", size: 4, httpOnly: false, secure: false, sameSite: "default" },
          { name: "bin", value: { type: "base64", value: Buffer.from("héllo").toString("base64") }, domain: "example.test", path: "/a", size: 9, httpOnly: true, secure: true, sameSite: "lax", expiry: 1900000000 },
        ],
      }),
    });
    const context = await browser.newContext();
    const cookies = await context.cookies();
    assert.deepEqual(cookies, [
      { name: "sid", value: "1", domain: "example.test", path: "/", httpOnly: false, secure: false, sameSite: "default" },
      { name: "bin", value: "héllo", domain: "example.test", path: "/a", httpOnly: true, secure: true, sameSite: "lax", expiry: 1900000000 },
    ]);
    assert.deepEqual(commands("storage.getCookies"), [{ partition: { type: "storageKey", userContext: "u1" } }]);
  });

  it("cookies(filter) filters by name, domain and path", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await context.cookies({ name: "sid", domain: "example.test", path: "/" });
    await context.cookies({ name: "only-name" });
    assert.deepEqual(commands("storage.getCookies"), [
      { filter: { name: "sid", domain: "example.test", path: "/" }, partition: { type: "storageKey", userContext: "u1" } },
      { filter: { name: "only-name" }, partition: { type: "storageKey", userContext: "u1" } },
    ]);
  });

  it("clearCookies deletes all, or those the filter names", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await context.clearCookies();
    await context.clearCookies({ name: "sid" });
    assert.deepEqual(commands("storage.deleteCookies"), [
      { partition: { type: "storageKey", userContext: "u1" } },
      { filter: { name: "sid" }, partition: { type: "storageKey", userContext: "u1" } },
    ]);
  });

  it("a page reaches its context's cookies through page.context()", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.context().addCookies([{ name: "a", value: "1", domain: "example.test" }]);
    assert.equal(commands("storage.setCookie")[0].partition.userContext, "u1");
  });
});

describe("BrowserContext.close", () => {
  it("removes the user context, and its pages are closed for good", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.close();
    assert.deepEqual(commands("browser.removeUserContext"), [{ userContext: "u1" }]);
    assert.equal(page.closed, true);
    await assert.rejects(page.url(), /page closed/);
    assert.deepEqual(context.pages(), []);
    assert.equal(context.closed, true);
    await assert.rejects(context.newPage(), /context closed/);
    await assert.rejects(context.cookies(), /context closed/);
  });

  it("closing twice sends nothing more", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await context.close();
    await context.close();
    assert.equal(commands("browser.removeUserContext").length, 1);
  });

  it("the default context cannot be closed", async () => {
    const { browser, commands } = setup();
    await assert.rejects(browser.defaultContext.close(), /cannot close the default context/);
    assert.equal(commands("browser.removeUserContext").length, 0);
  });

  it("a context the browser no longer knows counts as closed", async () => {
    const { browser } = setup({ "browser.removeUserContext": () => failing("no such user context") });
    const context = await browser.newContext();
    await assert.doesNotReject(context.close());
    assert.equal(context.closed, true);
  });

  it("other errors are thrown and the context stays open", async () => {
    const { browser } = setup({ "browser.removeUserContext": () => failing("unknown error") });
    const context = await browser.newContext();
    await assert.rejects(context.close(), { code: "unknown error" });
    assert.equal(context.closed, false);
  });
});

describe("Browser.close", () => {
  it("removes the contexts it created before the browser goes, so they do not pile up in the profile", async () => {
    const { ws, browser } = setup({ "browser.close": () => ({}) });
    await browser.newContext();
    await browser.newContext();
    await browser.close();
    const order = ws.sent.map((m) => m.method).filter((m) => m === "browser.removeUserContext" || m === "browser.close");
    assert.deepEqual(order, ["browser.removeUserContext", "browser.removeUserContext", "browser.close"]);
  });

  it("a context that cannot be removed does not keep the browser open", async () => {
    const { browser } = setup({
      "browser.removeUserContext": () => failing("unknown error"),
      "browser.close": () => ({}),
    });
    await browser.newContext();
    await assert.doesNotReject(browser.close());
  });
});

describe("emulation", () => {
  const url = (value: string) => ({ "script.callFunction": () => ({ type: "success", realm: "r", result: { type: "string", value } }) });

  it("context.emulate applies to the whole user context", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await context.emulate({ locale: "de-DE", timezone: "Europe/Berlin" });
    assert.deepEqual(commands("emulation.setLocaleOverride"), [{ locale: "de-DE", userContexts: ["u1"] }]);
    assert.deepEqual(commands("emulation.setTimezoneOverride"), [{ timezone: "Europe/Berlin", userContexts: ["u1"] }]);
  });

  it("the default context is targeted as the default user context", async () => {
    const { browser, commands } = setup();
    await browser.defaultContext.emulate({ offline: true });
    assert.deepEqual(commands("emulation.setNetworkConditions"), [
      { networkConditions: { type: "offline" }, userContexts: ["default"] },
    ]);
  });

  it("page.emulate applies to that page only", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.emulate({ locale: "fr-FR", geolocation: null });
    assert.deepEqual(commands("emulation.setLocaleOverride"), [{ locale: "fr-FR", contexts: ["tab-1"] }]);
    assert.deepEqual(commands("emulation.setGeolocationOverride"), [{ coordinates: null, contexts: ["tab-1"] }]);
  });

  it("page.emulate on a closed page is refused", async () => {
    const { browser } = setup({ "browsingContext.close": () => ({}) });
    const page = await (await browser.newContext()).newPage();
    await page.close();
    await assert.rejects(page.emulate({ locale: "nl-NL" }), /page closed/);
  });

  it("context.emulate on a closed context is refused", async () => {
    const { browser } = setup();
    const context = await browser.newContext();
    await context.close();
    await assert.rejects(context.emulate({ locale: "nl-NL" }), /context closed/);
  });

  it("newContext applies emulation options before the first page can exist", async () => {
    const { ws, browser, commands } = setup();
    const context = await browser.newContext({ acceptInsecureCerts: true, locale: "nl-NL", timezone: "Europe/Amsterdam", offline: false });
    assert.deepEqual(commands("browser.createUserContext"), [{ acceptInsecureCerts: true }], "only the context options go to createUserContext");
    assert.deepEqual(commands("emulation.setLocaleOverride"), [{ locale: "nl-NL", userContexts: [context.id] }]);
    assert.deepEqual(commands("emulation.setNetworkConditions"), [{ networkConditions: null, userContexts: [context.id] }]);
    await context.newPage();
    const order = ws.sent.map((m) => m.method).filter((m) => m.startsWith("emulation.") || m === "browsingContext.create");
    assert.equal(order[order.length - 1], "browsingContext.create");
    assert.equal(order.filter((m) => m === "browsingContext.create").length, 1);
  });

  it("a context whose emulation fails is removed again, so nothing is left in the profile", async () => {
    const { browser, commands } = setup({ "emulation.setTimezoneOverride": () => failing("invalid argument", "bad tz") });
    await assert.rejects(browser.newContext({ locale: "nl-NL", timezone: "Europe/Amsterdam" }), { name: "EmulationError" });
    assert.deepEqual(commands("browser.removeUserContext"), [{ userContext: "u1" }]);
    assert.deepEqual(browser.contexts().map((c) => c.id), ["default"]);
  });

  it("an unsupported option removes the new context too", async () => {
    const { browser, commands } = setup({ "emulation.setTouchOverride": () => failing("unknown command") });
    await assert.rejects(browser.newContext({ touch: 3 }), { name: "EmulationUnsupportedError" });
    assert.equal(commands("browser.removeUserContext").length, 1);
  });

  it("an invalid value is refused before a context is even created", async () => {
    const { browser, commands } = setup();
    await assert.rejects(browser.newContext({ timezone: "Not/AZone" }), RangeError);
    assert.equal(commands("browser.createUserContext").length, 0);
  });

  it("no emulation options, no emulation commands", async () => {
    const { ws, browser } = setup();
    await browser.newContext({ acceptInsecureCerts: false });
    assert.equal(ws.sent.filter((m) => m.method.startsWith("emulation.")).length, 0);
  });

  it("setPermission names the user context; the default context leaves it out", async () => {
    const { browser, commands } = setup({ "permissions.setPermission": () => ({}) });
    const context = await browser.newContext();
    await context.setPermission("geolocation", "granted", "https://example.test");
    await browser.defaultContext.setPermission("notifications", "denied", "https://example.test");
    assert.deepEqual(commands("permissions.setPermission"), [
      { descriptor: { name: "geolocation" }, state: "granted", origin: "https://example.test", userContext: "u1" },
      { descriptor: { name: "notifications" }, state: "denied", origin: "https://example.test" },
    ]);
  });

  it("page.grantPermission grants for the origin the page is on, in its context", async () => {
    const { browser, commands } = setup({ "permissions.setPermission": () => ({}), ...url("https://shop.example.test:8443/cart?x=1") });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.grantPermission("geolocation");
    await page.grantPermission("camera", { origin: "https://other.test" });
    assert.deepEqual(commands("permissions.setPermission"), [
      { descriptor: { name: "geolocation" }, state: "granted", origin: "https://shop.example.test:8443", userContext: "u1" },
      { descriptor: { name: "camera" }, state: "granted", origin: "https://other.test", userContext: "u1" },
    ]);
  });

  it("page.grantPermission needs a real origin", async () => {
    const { browser } = setup({ "permissions.setPermission": () => ({}), ...url("about:blank") });
    const page = await (await browser.newContext()).newPage();
    await assert.rejects(page.grantPermission("geolocation"), /needs a page on a web origin/);
    await assert.doesNotReject(page.grantPermission("geolocation", { origin: "https://example.test" }));
  });
});
