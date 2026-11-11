import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setup, stops } from "../testing/browser-context-fixture.js";

afterEach(() => stops.splice(0).forEach((stop) => stop()));

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
    await browser.newContext({
      acceptInsecureCerts: true,
      unhandledPromptBehavior: { default: "dismiss" },
    });
    assert.deepEqual(commands("browser.createUserContext"), [
      {
        acceptInsecureCerts: true,
        unhandledPromptBehavior: { default: "dismiss" },
      },
    ]);
  });

  it("knows the default context, and lists the ones this browser created", async () => {
    const { browser } = setup();
    assert.equal(browser.defaultContext.id, "default");
    assert.equal(browser.defaultContext.isDefault, true);
    assert.deepEqual(
      browser.contexts().map((c) => c.id),
      ["default"],
    );
    const a = await browser.newContext();
    const b = await browser.newContext();
    assert.deepEqual(
      browser.contexts().map((c) => c.id),
      ["default", "u1", "u2"],
    );
    await a.close();
    assert.deepEqual(browser.contexts(), [browser.defaultContext, b]);
  });
});

describe("BrowserContext.newPage", () => {
  it("opens a tab in the user context and binds the page to it", async () => {
    const { browser, commands } = setup();
    const context = await browser.newContext();
    const page = await context.newPage();
    assert.deepEqual(commands("browsingContext.create"), [
      { type: "tab", userContext: "u1" },
    ]);
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
    const inContext = await browser.newPage({
      type: "tab",
      userContext: context.id,
    });
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
