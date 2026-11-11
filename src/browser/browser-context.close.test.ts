import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { failing, setup, stops } from "../testing/browser-context-fixture.js";

afterEach(() => stops.splice(0).forEach((stop) => stop()));

describe("BrowserContext.close", () => {
  it("removes the user context, and its pages are closed for good", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.close();
    assert.deepEqual(commands("browser.removeUserContext"), [
      { userContext: "u1" },
    ]);
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
    await assert.rejects(
      browser.defaultContext.close(),
      /cannot close the default context/,
    );
    assert.equal(commands("browser.removeUserContext").length, 0);
  });

  it("a context the browser no longer knows counts as closed", async () => {
    const { browser } = setup({
      "browser.removeUserContext": () => failing("no such user context"),
    });
    const context = await browser.newContext();
    await assert.doesNotReject(context.close());
    assert.equal(context.closed, true);
  });

  it("other errors are thrown and the context stays open", async () => {
    const { browser } = setup({
      "browser.removeUserContext": () => failing("unknown error"),
    });
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
    const order = ws.sent
      .map((m) => m.method)
      .filter(
        (m) => m === "browser.removeUserContext" || m === "browser.close",
      );
    assert.deepEqual(order, [
      "browser.removeUserContext",
      "browser.removeUserContext",
      "browser.close",
    ]);
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
