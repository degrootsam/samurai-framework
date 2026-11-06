import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { Browser } from "../../browser/browser.js";
import type Page from "../../browser/page.js";
import { testBrowser } from "../../testing/test-browser.js";
import { installPlanGuard } from "./guard.js";

const OPTIONS = { timeout: 60000 };
let browser: Browser;
let page: Page;
let server: Server;
let base: string;
const sockets = new Set<Socket>();
let hits: string[] = [];
let blocked: string[] = [];

const FORM = `<!doctype html><title>form</title><body>
<form id="f" method="post" action="/submit"><input name="a" value="1"><button id="go">Send</button></form>
<form id="g" method="get" action="/search"><input name="q" value="x"><button id="find">Find</button></form>
</body>`;

before(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      if (path !== "/favicon.ico") hits.push(`${req.method} ${path}`);
      res
        .setHeader("content-type", "text/html")
        .end(
          path === "/" ? FORM : `<title>${path}</title><body>${path}</body>`,
        );
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9611,
    headless: true,
  }));
  await installPlanGuard(page, (what) => blocked.push(what));
});

after(async () => {
  await page.dispose();
  await browser?.close();
  sockets.forEach((socket) => socket.destroy());
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  hits = [];
  blocked = [];
  await page.navigateTo(`${base}/`);
  hits = [];
});

test(
  "a fetch POST fails in the page and never reaches the server",
  OPTIONS,
  async () => {
    const failed = await page.evaluate(
      `fetch("/api/feedback", { method: "POST", body: "x" }).then(() => false, () => true)`,
    );
    assert.equal(failed, true);
    assert.deepEqual(blocked, ["POST /api/feedback"]);
    assert.deepEqual(hits, []);
  },
);

test("an XHR PUT and a sendBeacon are blocked", OPTIONS, async () => {
  await page.evaluate(`new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("PUT", "/api/item");
    x.onloadend = () => { navigator.sendBeacon("/api/beacon", "b"); resolve(true); };
    x.send("y");
  })`);
  await page.evaluate(`new Promise((r) => setTimeout(r, 300))`);
  assert.deepEqual(blocked.sort(), ["POST /api/beacon", "PUT /api/item"]);
  assert.deepEqual(hits, []);
});

test(
  "a form submit by click is a POST that the guard stops",
  OPTIONS,
  async () => {
    await page.locator("#go").click();
    await page.evaluate(`new Promise((r) => setTimeout(r, 500))`);
    assert.deepEqual(blocked, ["POST /submit"]);
    assert.deepEqual(hits, [], "the server saw the POST");
    assert.equal(await page.url(), `${base}/`, "the page stayed");
    assert.equal(await page.title(), "form");
  },
);

test("a form submit by Enter is stopped too", OPTIONS, async () => {
  await page.locator("input[name=a]").press("Enter");
  await page.evaluate(`new Promise((r) => setTimeout(r, 500))`);
  assert.deepEqual(blocked, ["POST /submit"]);
  assert.deepEqual(hits, []);
});

test("GET requests pass: fetch, a GET form and a link", OPTIONS, async () => {
  const status = await page.evaluate(`fetch("/data").then((r) => r.status)`);
  assert.equal(status, 200);
  await page.locator("#find").click();
  await page.waitForURL(/\/search\?q=x/);
  assert.deepEqual(blocked, []);
  assert.deepEqual(hits, ["GET /data", "GET /search"]);
});
