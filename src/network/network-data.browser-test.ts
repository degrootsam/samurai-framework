import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { Browser } from "../browser/browser.js";
import Page from "../browser/page.js";
import { callFunction } from "../script/call-function.js";
import { setContent } from "../testing/browser-fixture.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { ResponseBodyUnavailableError } from "./data-collector.js";
import { ResponseTimeoutError } from "./network-wait.js";

let browser: Browser;
let page: Page;
let server: Server;
let base: string;
const sockets = new Set<Socket>();
const BINARY = Buffer.from([0, 1, 2, 3, 128, 200, 254, 255]);
let cachedHits = 0;

before(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    switch (path) {
      case "/real":
        res.setHeader("content-type", "text/html; charset=utf-8").end("<!doctype html><body id='b'>héllo document</body>");
        break;
      case "/json":
        res.setHeader("content-type", "application/json").end(JSON.stringify({ users: [{ id: 1, name: "Zoë" }] }));
        break;
      case "/text":
        res.setHeader("content-type", "text/plain; charset=utf-8").end("plain ✓ text");
        break;
      case "/binary":
        res.setHeader("content-type", "application/octet-stream").end(BINARY);
        break;
      case "/big":
        res.setHeader("content-type", "text/plain").end("x".repeat(5000));
        break;
      case "/redirect":
        res.writeHead(302, { location: "/json" }).end();
        break;
      case "/cached":
        cachedHits++;
        res.setHeader("content-type", "text/plain").setHeader("cache-control", "max-age=600").end(`hit ${cachedHits}`);
        break;
      case "/empty":
        res.writeHead(204).end();
        break;
      default:
        res.setHeader("content-type", "text/plain").end("ok");
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  ({ browser, page } = await Browser.launch("firefox", { port: 9243, headless: true }));
  await page.navigateTo(`${base}/real`);
});

after(async () => {
  await page.dispose();
  await browser?.close();
  sockets.forEach((socket) => socket.destroy());
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await page.setCacheDisabled(false);
});

const OPTIONS = { timeout: 30000 };
const connector = () => (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector;
const run = <T>(source: string) => callFunction<T>(connector(), page.contextId, source);
const fetchInPage = (path: string) => run(`() => { fetch(${JSON.stringify(base + path)}).catch(() => {}); }`);

test("json() reads a JSON body", OPTIONS, async () => {
  const response = await page.waitForResponse("**/json", { trigger: () => fetchInPage("/json") });
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json");
  assert.deepEqual(await response.json(), { users: [{ id: 1, name: "Zoë" }] });
});

test("text() decodes UTF-8", OPTIONS, async () => {
  const response = await page.waitForResponse("**/text", { trigger: () => fetchInPage("/text") });
  assert.equal(await response.text(), "plain ✓ text");
});

test("body() returns binary content byte for byte", OPTIONS, async () => {
  const response = await page.waitForResponse("**/binary", { trigger: () => fetchInPage("/binary") });
  assert.deepEqual([...(await response.body())], [...BINARY]);
});

test("the body can be read again and again", OPTIONS, async () => {
  const response = await page.waitForResponse("**/json", { trigger: () => fetchInPage("/json") });
  const first = await response.text();
  assert.equal(await response.text(), first);
  assert.deepEqual(await response.json(), JSON.parse(first));
});

test("an empty response has an empty body", OPTIONS, async () => {
  const response = await page.waitForResponse("**/empty", { trigger: () => fetchInPage("/empty") });
  assert.equal(response.status, 204);
  assert.equal((await response.body()).length, 0);
});

test("the document of a navigation has a body too", OPTIONS, async () => {
  const document = await page.waitForResponse((r) => r.request.resourceType === "document" && r.url.endsWith("/real?doc"), {
    trigger: async () => {
      await page.navigateTo(`${base}/real?doc`);
    },
  });
  assert.match(await document.text(), /héllo document/);
});

test("a redirect response has no body, the target has", OPTIONS, async () => {
  const seen: string[] = [];
  const onResponse = (response: { status: number; url: string }) => {
    if (/\/(redirect|json)$/.test(response.url)) seen.push(`${response.status} ${new URL(response.url).pathname}`);
  };
  page.on("response", onResponse);
  const first = await page.waitForResponse("**/redirect", { trigger: () => fetchInPage("/redirect") });
  await page.waitForNetworkIdle({ idleTime: 100, timeout: 5000 });
  page.off("response", onResponse);
  assert.equal(first.status, 302);
  await assert.rejects(first.body(), (err: unknown) => {
    assert.ok(err instanceof ResponseBodyUnavailableError);
    assert.equal(err.reason, "redirect response");
    return true;
  });
  assert.deepEqual(seen, ["302 /redirect", "200 /json"]);
});

test("waitForResponse with a click as its trigger", OPTIONS, async () => {
  await setContent(
    page,
    `<button id="load">Load</button>`,
    `document.getElementById("load").addEventListener("click", () => fetch(${JSON.stringify(base + "/json?click")}));`,
  );
  const response = await page.waitForResponse((r) => r.url.endsWith("/json?click"), {
    trigger: () => page.locator("button[@id='load']").click({ timeout: 5000 }),
  });
  assert.equal((await response.json<{ users: unknown[] }>()).users.length, 1);
});

test("waitForRequest sees the request before its response", OPTIONS, async () => {
  const request = await page.waitForRequest("**/text?req", { trigger: () => fetchInPage("/text?req") });
  assert.equal(request.method, "GET");
  assert.equal(request.url, `${base}/text?req`);
});

test("a body over maxBodySize is reported as unavailable, with the reason", OPTIONS, async () => {
  // A second view of the same page, with a small limit
  const small = new Page(connector(), page.contextId, { network: { maxBodySize: 100 } });
  try {
    const response = await small.waitForResponse("**/big", { trigger: () => fetchInPage("/big") });
    await assert.rejects(response.text(), (err: unknown) => {
      assert.ok(err instanceof ResponseBodyUnavailableError);
      assert.match(err.reason, /larger than maxBodySize/);
      return true;
    });
    const fits = await small.waitForResponse("**/text", { trigger: () => fetchInPage("/text") });
    assert.equal(await fits.text(), "plain ✓ text");
  } finally {
    await small.dispose();
  }
});

test("waitForResponse times out naming what it waited for", OPTIONS, async () => {
  await assert.rejects(page.waitForResponse("**/never", { timeout: 300 }), (err: unknown) => {
    assert.ok(err instanceof ResponseTimeoutError);
    assert.equal(err.message, 'waitForResponse(): no response matching "**/never" within 300ms');
    return true;
  });
});

test("setCacheDisabled makes every request reach the server", OPTIONS, async () => {
  const twice = async (path: string) => {
    cachedHits = 0;
    await run(`async () => { await (await fetch(${JSON.stringify(base + path)})).text(); await (await fetch(${JSON.stringify(base + path)})).text(); }`);
    return cachedHits;
  };
  assert.equal(await twice("/cached?default"), 1, "the second fetch came from the cache");
  await page.setCacheDisabled(true);
  assert.equal(await twice("/cached?bypass"), 2, "with the cache off both fetches hit the server");
  await page.setCacheDisabled(false);
  assert.equal(await twice("/cached?again"), 1, "back on");
});
