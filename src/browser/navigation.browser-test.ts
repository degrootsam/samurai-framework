import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, before, test } from "node:test";
import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { Browser } from "./browser.js";
import { LoadStateTimeoutError, NavigationError } from "./navigation-error.js";
import type Page from "./page.js";

let browser: Browser;
let page: Page;
let server: Server;
let base: string;
const sockets = new Set<Socket>();

const GIF = Buffer.from("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "base64");

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    switch (url.pathname) {
      case "/late": // DOMContentLoaded at once, load only after the slow image
        res.setHeader("content-type", "text/html").end('<!doctype html><body>late<img src="/img?ms=700"></body>');
        break;
      case "/img":
        setTimeout(() => res.setHeader("content-type", "image/gif").end(GIF), Number(url.searchParams.get("ms")));
        break;
      case "/hang":
        break;
      case "/link":
        res.setHeader("content-type", "text/html").end('<!doctype html><body><a id="go" href="/late">go</a></body>');
        break;
      default:
        res.setHeader("content-type", "text/html").end(`<!doctype html><body>page ${url.pathname}</body>`);
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  ({ browser, page } = await Browser.launch("firefox", { port: 9238, headless: true }));
});

after(async () => {
  await page.dispose();
  await browser?.close();
  sockets.forEach((socket) => socket.destroy());
  await new Promise((resolve) => server.close(resolve));
});

const OPTIONS = { timeout: 40000 };
const readyState = () =>
  callFunction<string>(
    (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector,
    page.contextId,
    "() => document.readyState",
  );
const imageLoaded = () =>
  callFunction<boolean>(
    (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector,
    page.contextId,
    "() => Array.from(document.images).every((image) => image.complete)",
  );

async function timed<T>(action: () => Promise<T>) {
  const started = Date.now();
  const value = await action();
  return { value, took: Date.now() - started };
}

test("complete (the default) resolves after the slow subresource, interactive before it", OPTIONS, async () => {
  const complete = await timed(() => page.navigateTo(`${base}/late?complete`));
  assert.ok(complete.took >= 650, `resolved before the image loaded: ${complete.took}ms`);
  assert.equal(await imageLoaded(), true);
  assert.equal(typeof complete.value.navigation, "string");
  assert.equal(complete.value.url, `${base}/late?complete`);

  const interactive = await timed(() => page.navigateTo(`${base}/late?interactive`, { wait: "interactive" }));
  assert.ok(interactive.took < 500, `interactive waited for the image: ${interactive.took}ms`);
  assert.equal(await imageLoaded(), false);
  await page.waitForLoadState("load", { timeout: 5000 });
  assert.equal(await imageLoaded(), true);
});

test("none returns at once; waitForLoadState then waits for that navigation, not the old document", OPTIONS, async () => {
  await page.navigateTo(`${base}/quiet`); // a loaded document to start from
  const none = await timed(() => page.navigateTo(`${base}/late?none`, { wait: "none" }));
  assert.ok(none.took < 400, `none waited: ${none.took}ms`);
  const load = await timed(() => page.waitForLoadState("load", { timeout: 10000 }));
  assert.ok(none.took + load.took >= 600 || load.took >= 400, `resolved on the old document: ${load.took}ms`);
  assert.equal(await imageLoaded(), true);
  assert.equal(await readyState(), "complete");
});

test("domcontentloaded comes before load", OPTIONS, async () => {
  await page.navigateTo(`${base}/quiet`);
  await page.navigateTo(`${base}/late?dcl`, { wait: "none" });
  const dcl = await timed(() => page.waitForLoadState("domcontentloaded", { timeout: 10000 }));
  assert.ok(dcl.took < 600, `domcontentloaded waited for the image: ${dcl.took}ms`);
  await page.waitForLoadState("load", { timeout: 10000 });
});

test("networkidle waits for the load and a quiet network", OPTIONS, async () => {
  await page.navigateTo(`${base}/quiet`);
  await page.navigateTo(`${base}/late?idle`, { wait: "none" });
  const idle = await timed(() => page.waitForLoadState("networkidle", { timeout: 10000 }));
  assert.ok(idle.took >= 500, `did not wait for the image: ${idle.took}ms`);
  assert.equal(await imageLoaded(), true);
});

test("an already loaded page is ready at once", OPTIONS, async () => {
  await page.navigateTo(`${base}/quiet`);
  const load = await timed(() => page.waitForLoadState("load", { timeout: 5000 }));
  assert.ok(load.took < 300, `took ${load.took}ms`);
});

test("a refused connection is a NavigationError naming the url", OPTIONS, async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const closedPort = (probe.address() as AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));
  const url = `http://127.0.0.1:${closedPort}/`;
  await assert.rejects(page.navigateTo(url), (err) => {
    assert.ok(err instanceof NavigationError, String(err));
    assert.equal(err.url, url);
    assert.ok(err.reason.length > 0);
    assert.match(err.message, /^navigateTo\(\): http:\/\/127\.0\.0\.1:\d+\/ failed: /);
    return true;
  });
});

test("Firefox reports a refused connection from navigate itself, even with wait none", OPTIONS, async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const closedPort = (probe.address() as AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));
  await page.navigateTo(`${base}/quiet`);
  await assert.rejects(page.navigateTo(`http://127.0.0.1:${closedPort}/`, { wait: "none" }), NavigationError);
});

test("a link click followed by waitForLoadState ends up on the loaded target", OPTIONS, async () => {
  await page.navigateTo(`${base}/link`);
  await page.locator("a[@id='go']").click({ timeout: 5000 });
  // the navigation has started once the URL changes
  await page.locator("img").waitFor({ state: "attached", timeout: 10000 });
  await page.waitForLoadState("load", { timeout: 10000 });
  assert.equal(await imageLoaded(), true);
});

test("a server that never answers hits the navigation timeout", OPTIONS, async () => {
  const { took } = await timed(async () => {
    await assert.rejects(page.navigateTo(`${base}/hang`, { timeout: 800 }), (err) => {
      assert.ok(err instanceof NavigationError);
      assert.equal(err.reason, "timeout after 800ms");
      assert.equal(err.code, "timeout");
      return true;
    });
  });
  assert.ok(took >= 750 && took < 3000, `took ${took}ms`);
});

test("waitForLoadState times out with its own error", OPTIONS, async () => {
  await page.navigateTo(`${base}/quiet`);
  await page.navigateTo(`${base}/late?timeout`, { wait: "none" });
  // the image needs 700ms: the load state is not reached in 250ms
  await assert.rejects(page.waitForLoadState("load", { timeout: 250 }), LoadStateTimeoutError);
  await page.waitForLoadState("load", { timeout: 5000 });
});
