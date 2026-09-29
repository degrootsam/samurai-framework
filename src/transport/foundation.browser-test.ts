import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { BiDiError } from "./bidi-error.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", { port: 9232, headless: true }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 15000 };

test("newPage returns a page that can navigate", OPTIONS, async () => {
  const created = await browser.newPage({ type: "tab" });
  assert.notEqual(created.contextId, "");
  assert.notEqual(created.contextId, page.contextId);
  await created.navigateTo("about:blank", "complete");
});

test("a failing command rejects with the BiDi error code instead of hanging", OPTIONS, async () => {
  const connector = (page as unknown as { biDiConnector: import("./bidi-connection.js").BiDiConnector })
    .biDiConnector;
  await assert.rejects(
    connector.send("script.evaluate", {
      expression: "1",
      awaitPromise: false,
      target: { context: "does-not-exist" },
    }),
    (err: unknown) => err instanceof BiDiError && err.code === "no such frame",
  );
});

test("context tree attributes iframe contexts to the page", OPTIONS, async () => {
  await page.navigateTo("about:blank", "complete");
  const tree = await page.tree();
  const connector = (page as unknown as { biDiConnector: import("./bidi-connection.js").BiDiConnector })
    .biDiConnector;
  const created = connector.waitForEvent("browsingContext.contextCreated", (info) => info.parent === page.contextId, {
    timeout: 5000,
  });
  await connector.send("script.evaluate", {
    expression: `document.body.appendChild(document.createElement("iframe")).src = "about:blank"; 1`,
    awaitPromise: false,
    target: { context: page.contextId },
  });
  const frame = await created;
  assert.equal(tree.isWithin(frame.context, page.contextId), true);
  assert.equal(tree.rootOf(frame.context), page.contextId);
});

test("refcounted subscriptions deliver events to every subscriber", OPTIONS, async () => {
  const connector = (page as unknown as { biDiConnector: import("./bidi-connection.js").BiDiConnector })
    .biDiConnector;
  const a = await connector.subscribe(["browsingContext.load"]);
  const b = await connector.subscribe(["browsingContext.load"]);
  const seen = connector.waitForEvent("browsingContext.load", (p) => p.context === page.contextId, { timeout: 5000 });
  await page.navigateTo("about:blank?again", "none");
  await seen;
  await a.unsubscribe();
  // b still holds the subscription, so events keep flowing
  const again = connector.waitForEvent("browsingContext.load", (p) => p.context === page.contextId, { timeout: 5000 });
  await page.navigateTo("about:blank?third", "none");
  await again;
  await b.unsubscribe();
});
