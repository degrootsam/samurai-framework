import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { callFunction } from "../script/call-function.js";
import { NetworkIdleTimeoutError } from "./network-tracker.js";
import type { FailedRequest, NetworkRequest, NetworkResponse } from "./network-tracker.js";

let browser: Browser;
let page: Page;
let server: Server;
let base: string;
const sockets = new Set<Socket>();
const hits: string[] = [];

before(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? "");
    switch (req.url?.split("?")[0]) {
      case "/":
        res.setHeader("content-type", "text/html").end("<!doctype html><title>t</title><body>home</body>");
        break;
      case "/slow":
        setTimeout(() => res.setHeader("content-type", "text/plain").end("slow"), 300);
        break;
      case "/redirect":
        res.writeHead(302, { location: "/slow" }).end();
        break;
      case "/fail":
        req.socket.destroy();
        break;
      case "/hang":
        break; // never answers
      case "/frame":
        res.setHeader("content-type", "text/html").end('<body>frame<script>fetch("/slow")</script></body>');
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

  ({ browser, page } = await Browser.launch("firefox", { port: 9237, headless: true }));
  await page.navigateTo(`${base}/`, "complete");
});

after(async () => {
  await page.dispose();
  await browser?.close();
  sockets.forEach((socket) => socket.destroy());
  await new Promise((resolve) => server.close(resolve));
});

const OPTIONS = { timeout: 30000 };
const connector = () => (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector;
const run = (source: string) => callFunction(connector(), page.contextId, source);
const IDLE = { idleTime: 200, timeout: 10000 };

test("idle waits for the last of several timed requests, then for idleTime", OPTIONS, async () => {
  await run(`() => {
    fetch("/slow?a");
    setTimeout(() => fetch("/slow?b"), 200);
    setTimeout(() => fetch("/slow?c"), 400);
  }`);
  const started = Date.now();
  await page.waitForNetworkIdle(IDLE);
  const took = Date.now() - started;
  // last request starts at ~400ms, takes 300ms, then 200ms of quiet
  assert.ok(took >= 850, `resolved too early: ${took}ms`);
  assert.ok(hits.includes("/slow?c"));
});

test("an already quiet page is idle after idleTime", OPTIONS, async () => {
  await page.waitForNetworkIdle({ idleTime: 100, timeout: 5000 });
  const started = Date.now();
  await page.waitForNetworkIdle({ idleTime: 150, timeout: 5000 });
  const took = Date.now() - started;
  assert.ok(took >= 140 && took < 2000, `took ${took}ms`);
});

test("a redirect chain is followed to its end and linked", OPTIONS, async () => {
  const requests: NetworkRequest[] = [];
  const responses: NetworkResponse[] = [];
  const onRequest = (request: NetworkRequest) => requests.push(request);
  const onResponse = (response: NetworkResponse) => responses.push(response);
  page.on("request", onRequest);
  page.on("response", onResponse);
  await run(`() => { fetch("/redirect"); }`);
  await page.waitForNetworkIdle(IDLE);
  page.off("request", onRequest);
  page.off("response", onResponse);

  const hops = requests.filter((request) => request.url.includes("/redirect") || request.url.endsWith("/slow"));
  assert.equal(hops.length, 2);
  assert.equal(hops[0]!.url, `${base}/redirect`);
  assert.equal(hops[1]!.url, `${base}/slow`);
  assert.equal(hops[1]!.redirectedFrom, hops[0]);
  assert.deepEqual(responses.map((response) => response.status), [302, 200]);
  assert.equal(responses[1]!.headers["content-type"], "text/plain");
});

test("a failed request is reported and does not keep the page busy", OPTIONS, async () => {
  const failed: FailedRequest[] = [];
  const onFailed = (request: FailedRequest) => failed.push(request);
  page.on("requestfailed", onFailed);
  await run(`() => { fetch("/fail").catch(() => {}); }`);
  await page.waitForNetworkIdle(IDLE);
  page.off("requestfailed", onFailed);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.url, `${base}/fail`);
  assert.ok(failed[0]!.errorText.length > 0);
});

test("requests of an iframe count towards the page", OPTIONS, async () => {
  await run(`() => {
    const frame = document.createElement("iframe");
    frame.src = "/frame";
    document.body.appendChild(frame);
  }`);
  const started = Date.now();
  await page.waitForNetworkIdle(IDLE);
  // frame document, then the frame's own slow fetch (300ms)
  assert.ok(Date.now() - started >= 450, `resolved before the frame's request finished: ${Date.now() - started}ms`);
});

test("a request that never ends is named when the wait times out", OPTIONS, async () => {
  await run(`() => { fetch("/hang").catch(() => {}); }`);
  await assert.rejects(page.waitForNetworkIdle({ idleTime: 100, timeout: 1000 }), (err) => {
    assert.ok(err instanceof NetworkIdleTimeoutError);
    assert.deepEqual(err.last, [`${base}/hang`]);
    return true;
  });
});

test("navigation requests are tracked from the start of the browser", OPTIONS, async () => {
  const requests: string[] = [];
  const onRequest = (request: NetworkRequest) => requests.push(`${request.resourceType} ${request.url}`);
  page.on("request", onRequest);
  await page.navigateTo(`${base}/?nav`, "complete");
  await page.waitForNetworkIdle(IDLE);
  page.off("request", onRequest);
  assert.ok(requests.includes(`document ${base}/?nav`), requests.join("\n"));
});
