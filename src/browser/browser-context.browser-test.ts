import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, before, test } from "node:test";
import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { Browser } from "./browser.js";
import type { BrowserContext } from "./browser-context.js";
import type Page from "./page.js";

let browser: Browser;
let server: Server;
let base: string;
const sockets = new Set<Socket>();
const createdIds: string[] = [];

before(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html").end(`<!doctype html><body>${req.url}</body>`);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ browser } = await Browser.launch("firefox", { port: 9245, headless: true }));
});

after(async () => {
  await browser?.close();
  sockets.forEach((socket) => socket.destroy());
  await new Promise((resolve) => server.close(resolve));

  // Closing the browser took the contexts it had created out of the profile
  const { browser: again, page } = await Browser.launch("firefox", { port: 9246, headless: true });
  try {
    const connector = (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector;
    const { userContexts } = await connector.send("browser.getUserContexts", {});
    const remaining = userContexts.map((context) => context.userContext);
    assert.deepEqual(createdIds.filter((id) => remaining.includes(id)), [], "contexts left behind in the profile");
  } finally {
    await page.dispose();
    await again.close();
  }
});

const OPTIONS = { timeout: 40000 };
const connectorOf = (page: Page) => (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector;
const evaluate = <T>(page: Page, source: string) => callFunction<T>(connectorOf(page), page.contextId, source);
const cookieOf = (page: Page) => evaluate<string>(page, "() => document.cookie");

async function context(options?: Parameters<Browser["newContext"]>[0]): Promise<BrowserContext> {
  const created = await browser.newContext(options);
  createdIds.push(created.id);
  return created;
}

test("a context opens pages that can navigate, and knows them", OPTIONS, async () => {
  const alice = await context();
  const page = await alice.newPage();
  await page.navigateTo(`${base}/alice`);
  assert.equal(await page.locator("body").textContent(), "/alice");
  assert.equal(page.context(), alice);
  assert.deepEqual(alice.pages(), [page]);
  await alice.close();
});

test("cookies of one context are invisible to another, and to the default one", OPTIONS, async () => {
  const alice = await context();
  const bob = await context();
  const pageA = await alice.newPage();
  const pageB = await bob.newPage();
  await pageA.navigateTo(`${base}/`);
  await pageB.navigateTo(`${base}/`);

  await evaluate(pageA, `() => { document.cookie = "who=alice; path=/"; }`);
  assert.equal(await cookieOf(pageA), "who=alice");
  assert.equal(await cookieOf(pageB), "", "bob does not see alice's cookie");
  assert.deepEqual((await bob.cookies()).map((c) => c.name), []);
  assert.deepEqual((await alice.cookies()).map((c) => `${c.name}=${c.value}`), ["who=alice"]);

  await alice.close();
  await bob.close();
});

test("addCookies puts cookies where the context's pages read them", OPTIONS, async () => {
  const shopper = await context();
  const page = await shopper.newPage();
  await shopper.addCookies([
    { name: "sid", value: "abc123", url: base },
    { name: "theme", value: "dark", domain: "127.0.0.1", path: "/" },
  ]);
  await page.navigateTo(`${base}/`);
  assert.deepEqual((await cookieOf(page)).split("; ").sort(), ["sid=abc123", "theme=dark"]);
  await shopper.close();
});

test("cookies() reports what was set, with its attributes", OPTIONS, async () => {
  const shopper = await context();
  await shopper.addCookies([
    { name: "a", value: "1", domain: "127.0.0.1", httpOnly: true, sameSite: "lax", expiry: Math.floor(Date.now() / 1000) + 3600 },
    { name: "b", value: "2", domain: "127.0.0.1" },
  ]);
  const cookies = await shopper.cookies();
  const a = cookies.find((cookie) => cookie.name === "a")!;
  assert.equal(a.value, "1");
  assert.equal(a.httpOnly, true);
  assert.equal(a.sameSite, "lax");
  assert.equal(a.path, "/");
  assert.ok(a.expiry && a.expiry > Date.now() / 1000);
  const b = cookies.find((cookie) => cookie.name === "b")!;
  assert.equal(b.expiry, undefined, "a session cookie has no expiry");
  assert.deepEqual((await shopper.cookies({ name: "a" })).map((cookie) => cookie.name), ["a"]);
  assert.deepEqual((await shopper.cookies({ domain: "elsewhere.test" })).map((cookie) => cookie.name), []);
  await shopper.close();
});

test("clearCookies removes some or all", OPTIONS, async () => {
  const shopper = await context();
  await shopper.addCookies([
    { name: "keep", value: "1", domain: "127.0.0.1" },
    { name: "drop", value: "2", domain: "127.0.0.1" },
  ]);
  await shopper.clearCookies({ name: "drop" });
  assert.deepEqual((await shopper.cookies()).map((cookie) => cookie.name), ["keep"]);
  await shopper.clearCookies();
  assert.deepEqual(await shopper.cookies(), []);
  await shopper.close();
});

test("cookies are readable through a page's own context", OPTIONS, async () => {
  const shopper = await context();
  const page = await shopper.newPage();
  await page.navigateTo(`${base}/`);
  await evaluate(page, `() => { document.cookie = "from=page; path=/"; }`);
  assert.deepEqual((await page.context().cookies()).map((cookie) => `${cookie.name}=${cookie.value}`), ["from=page"]);
  await shopper.close();
});

test("closing a context closes its pages and refuses more use", OPTIONS, async () => {
  const temp = await context();
  const first = await temp.newPage();
  const second = await temp.newPage();
  await first.navigateTo(`${base}/one`);
  await temp.close();
  assert.equal(first.closed, true);
  assert.equal(second.closed, true);
  await assert.rejects(first.url(), /page closed/);
  assert.deepEqual(temp.pages(), []);
  await assert.rejects(temp.newPage(), /context closed/);
  assert.equal(browser.contexts().includes(temp), false);
});

test("the default context cannot be closed, and closing twice is harmless", OPTIONS, async () => {
  await assert.rejects(browser.defaultContext.close(), /cannot close the default context/);
  const temp = await context();
  await temp.close();
  await assert.doesNotReject(temp.close());
});

test("a dialog in a new context is handled like anywhere else", OPTIONS, async () => {
  const dialogs = await context();
  const page = await dialogs.newPage();
  await page.navigateTo(`${base}/dialog`);
  const seen: string[] = [];
  page.on("dialog", async (dialog) => {
    seen.push(dialog.message());
    await dialog.accept();
  });
  await callFunction(connectorOf(page), page.contextId, `() => { setTimeout(() => { window.__after = confirm("in a context"); }, 0); }`, [], { awaitPromise: false });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && (await evaluate<unknown>(page, "() => window.__after")) === undefined) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(await evaluate<boolean>(page, "() => window.__after"), true);
  assert.deepEqual(seen, ["in a context"]);
  await dialogs.close();
});

test("pages get the default viewport in every context", OPTIONS, async () => {
  const sized = await context();
  const page = await sized.newPage();
  await page.navigateTo(`${base}/size`);
  assert.deepEqual((await evaluate<number[]>(page, "() => [innerWidth, innerHeight]")), [1280, 720]);
  await sized.close();
});

test("acceptInsecureCerts is accepted when a context is created", OPTIONS, async () => {
  const lenient = await context({ acceptInsecureCerts: true });
  const page = await lenient.newPage();
  await page.navigateTo(`${base}/lenient`);
  assert.equal(await page.locator("body").textContent(), "/lenient");
  await lenient.close();
});

test("the contexts a test forgot are removed with the browser (checked after it closed)", OPTIONS, async () => {
  const forgotten = await context();
  await forgotten.newPage();
  assert.ok(browser.contexts().includes(forgotten));
});
