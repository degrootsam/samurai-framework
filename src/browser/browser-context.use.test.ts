import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { failing, setup, stops } from "../testing/browser-context-fixture.js";

afterEach(() => stops.splice(0).forEach((stop) => stop()));

describe("use", () => {
  const url = (value: string) => ({
    "script.callFunction": () => ({
      type: "success",
      realm: "r",
      result: { type: "string", value },
    }),
  });

  it("context.use applies to the whole user context", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    await context.use({ locale: "de-DE", timezone: "Europe/Berlin" });
    assert.deepEqual(commands("emulation.setLocaleOverride"), [
      { locale: "de-DE", userContexts: ["u1"] },
    ]);
    assert.deepEqual(commands("emulation.setTimezoneOverride"), [
      { timezone: "Europe/Berlin", userContexts: ["u1"] },
    ]);
  });

  it("the default context is targeted as the default user context", async () => {
    const { browser, commands } = setup();
    await browser.defaultContext.use({ offline: true });
    assert.deepEqual(commands("emulation.setNetworkConditions"), [
      { networkConditions: { type: "offline" }, userContexts: ["default"] },
    ]);
  });

  it("page.use applies to that page only", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.use({ locale: "fr-FR", geolocation: null });
    assert.deepEqual(commands("emulation.setLocaleOverride"), [
      { locale: "fr-FR", contexts: ["tab-1"] },
    ]);
    assert.deepEqual(commands("emulation.setGeolocationOverride"), [
      { coordinates: null, contexts: ["tab-1"] },
    ]);
  });

  it("page.use on a closed page is refused", async () => {
    const { browser } = setup({ "browsingContext.close": () => ({}) });
    const page = await (await browser.newContext()).newPage();
    await page.close();
    await assert.rejects(page.use({ locale: "nl-NL" }), /page closed/);
  });

  it("context.use on a closed context is refused", async () => {
    const { browser } = setup();
    const context = await browser.newContext();
    await context.close();
    await assert.rejects(context.use({ locale: "nl-NL" }), /context closed/);
  });

  it("newContext applies use options before the first page can exist", async () => {
    const { ws, browser, commands } = setup();
    const context = await browser.newContext({
      acceptInsecureCerts: true,
      locale: "nl-NL",
      timezone: "Europe/Amsterdam",
      offline: false,
    });
    assert.deepEqual(
      commands("browser.createUserContext"),
      [{ acceptInsecureCerts: true }],
      "only the context options go to createUserContext",
    );
    assert.deepEqual(commands("emulation.setLocaleOverride"), [
      { locale: "nl-NL", userContexts: [context.id] },
    ]);
    assert.deepEqual(commands("emulation.setNetworkConditions"), [
      { networkConditions: null, userContexts: [context.id] },
    ]);
    await context.newPage();
    const order = ws.sent
      .map((m) => m.method)
      .filter(
        (m) => m.startsWith("emulation.") || m === "browsingContext.create",
      );
    assert.equal(order[order.length - 1], "browsingContext.create");
    assert.equal(order.filter((m) => m === "browsingContext.create").length, 1);
  });

  it("a context whose use fails is removed again, so nothing is left in the profile", async () => {
    const { browser, commands } = setup({
      "emulation.setTimezoneOverride": () =>
        failing("invalid argument", "bad tz"),
    });
    await assert.rejects(
      browser.newContext({ locale: "nl-NL", timezone: "Europe/Amsterdam" }),
      { name: "UseError" },
    );
    assert.deepEqual(commands("browser.removeUserContext"), [
      { userContext: "u1" },
    ]);
    assert.deepEqual(
      browser.contexts().map((c) => c.id),
      ["default"],
    );
  });

  it("an unsupported option removes the new context too", async () => {
    const { browser, commands } = setup({
      "emulation.setTouchOverride": () => failing("unknown command"),
    });
    await assert.rejects(browser.newContext({ hasTouch: true }), {
      name: "UseUnsupportedError",
    });
    assert.equal(commands("browser.removeUserContext").length, 1);
  });

  it("an invalid value is refused before a context is even created", async () => {
    const { browser, commands } = setup();
    await assert.rejects(
      browser.newContext({ timezone: "Not/AZone" }),
      TypeError,
    );
    assert.equal(commands("browser.createUserContext").length, 0);
  });

  it("no use options, no emulation commands", async () => {
    const { ws, browser } = setup();
    await browser.newContext({ acceptInsecureCerts: false });
    assert.equal(
      ws.sent.filter((m) => m.method.startsWith("emulation.")).length,
      0,
    );
  });

  it("setPermission names the user context; the default context leaves it out", async () => {
    const { browser, commands } = setup({
      "permissions.setPermission": () => ({}),
    });
    const context = await browser.newContext();
    await context.setPermission(
      "geolocation",
      "granted",
      "https://example.test",
    );
    await browser.defaultContext.setPermission(
      "notifications",
      "denied",
      "https://example.test",
    );
    assert.deepEqual(commands("permissions.setPermission"), [
      {
        descriptor: { name: "geolocation" },
        state: "granted",
        origin: "https://example.test",
        userContext: "u1",
      },
      {
        descriptor: { name: "notifications" },
        state: "denied",
        origin: "https://example.test",
      },
    ]);
  });

  it("page.grantPermission grants for the origin the page is on, in its context", async () => {
    const { browser, commands } = setup({
      "permissions.setPermission": () => ({}),
      ...url("https://shop.example.test:8443/cart?x=1"),
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.grantPermission("geolocation");
    await page.grantPermission("camera", { origin: "https://other.test" });
    assert.deepEqual(commands("permissions.setPermission"), [
      {
        descriptor: { name: "geolocation" },
        state: "granted",
        origin: "https://shop.example.test:8443",
        userContext: "u1",
      },
      {
        descriptor: { name: "camera" },
        state: "granted",
        origin: "https://other.test",
        userContext: "u1",
      },
    ]);
  });

  it("page.grantPermission needs a real origin", async () => {
    const { browser } = setup({
      "permissions.setPermission": () => ({}),
      ...url("about:blank"),
    });
    const page = await (await browser.newContext()).newPage();
    await assert.rejects(
      page.grantPermission("geolocation"),
      /needs a page on a web origin/,
    );
    await assert.doesNotReject(
      page.grantPermission("geolocation", { origin: "https://example.test" }),
    );
  });
});
