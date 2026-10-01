import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";

let browser: Browser;
let page: Page;
let server: Server;
let base: string;
const sockets = new Set<Socket>();
/** What reached the server: method, url and request headers */
let hits: Array<{ method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];

const GIF = Buffer.from("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "base64");

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      // The browser asks for a favicon after a navigation; that is not what the tests look at
      if (path !== "/favicon.ico") {
        hits.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString() });
      }
      switch (path) {
        case "/api/users":
          res.setHeader("content-type", "application/json").end(JSON.stringify([{ id: 99, from: "server" }]));
          break;
        case "/echo":
          res.setHeader("content-type", "application/json").end(JSON.stringify({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() }));
          break;
        case "/img.gif":
          res.setHeader("content-type", "image/gif").end(GIF);
          break;
        case "/redirect":
          res.writeHead(302, { location: "/api/users" }).end();
          break;
        case "/frame":
          res.setHeader("content-type", "text/html").end('<body>frame<script>fetch("/api/users").then((r) => r.json()).then((d) => parent.postMessage(JSON.stringify(d), "*"))</script></body>');
          break;
        case "/real":
          res.setHeader("content-type", "text/html").end("<!doctype html><body>the real page</body>");
          break;
        default:
          res.setHeader("content-type", "text/plain").end("ok");
      }
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  ({ browser, page } = await Browser.launch("firefox", { port: 9241, headless: true }));
  await page.navigateTo(`${base}/real`);
});

after(async () => {
  await page.dispose();
  await browser?.close();
  sockets.forEach((socket) => socket.destroy());
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await page.unrouteAll();
  hits = [];
});

const OPTIONS = { timeout: 30000 };
const connector = () => (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector;
const run = <T>(source: string) => callFunction<T>(connector(), page.contextId, source);
const fetchJson = (path: string, init = "{}") =>
  run<{ status: number; type: string | null; body: unknown }>(`async () => {
    const response = await fetch(${JSON.stringify(base + path)}, ${init});
    return { status: response.status, type: response.headers.get("content-type"), body: await response.json() };
  }`);

test("fulfill answers a request with JSON, and the server never sees it", OPTIONS, async () => {
  await page.route(`${base}/api/users`, (route) => route.fulfill({ json: [{ id: 1, from: "mock" }] }));
  const result = await fetchJson("/api/users");
  assert.deepEqual(result, { status: 200, type: "application/json", body: [{ id: 1, from: "mock" }] });
  assert.deepEqual(hits, []);
});

test("fulfill sets the status, headers and text of the answer", OPTIONS, async () => {
  await page.route("**/teapot", (route) =>
    route.fulfill({ status: 418, contentType: "text/plain", headers: { "x-mock": "yes" }, body: "short and stout" }),
  );
  const result = await run<{ status: number; text: string; mock: string | null; length: string | null }>(`async () => {
    const response = await fetch(${JSON.stringify(base + "/teapot")});
    return { status: response.status, text: await response.text(), mock: response.headers.get("x-mock"), length: response.headers.get("content-length") };
  }`);
  assert.deepEqual(result, { status: 418, text: "short and stout", mock: "yes", length: "15" });
});

test("a Buffer body arrives byte for byte", OPTIONS, async () => {
  const bytes = Buffer.from([0, 1, 2, 3, 250, 251, 252, 255]);
  await page.route("**/binary", (route) => route.fulfill({ contentType: "application/octet-stream", body: bytes }));
  const received = await run<number[]>(`async () => {
    const response = await fetch(${JSON.stringify(base + "/binary")});
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  }`);
  assert.deepEqual(received, [...bytes]);
});

test("routes that do not match leave requests alone", OPTIONS, async () => {
  await page.route(`${base}/api/users`, (route) => route.fulfill({ json: [] }));
  const other = await fetchJson("/echo");
  assert.equal((other.body as { method: string }).method, "GET");
  assert.deepEqual(hits.map((hit) => hit.url), ["/echo"]);
});

test("globs and regular expressions match", OPTIONS, async () => {
  await page.route("**/glob/*", (route) => route.fulfill({ json: "glob" }));
  await page.route(/\/regex\/\d+$/, (route) => route.fulfill({ json: "regex" }));
  assert.equal((await fetchJson("/glob/anything")).body, "glob");
  assert.equal((await fetchJson("/regex/42")).body, "regex");
  assert.deepEqual(hits, []);
});

test("abort makes an image fail to load", OPTIONS, async () => {
  await page.route(/\.gif\?abort$/, (route) => route.abort());
  const outcome = await run<string>(`() => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve("loaded");
    image.onerror = () => resolve("error");
    image.src = ${JSON.stringify(base + "/img.gif?abort")};
  })`);
  assert.equal(outcome, "error");
  assert.deepEqual(hits, []);
  await page.unrouteAll();
  const after = await run<string>(`() => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve("loaded");
    image.onerror = () => resolve("error");
    image.src = ${JSON.stringify(base + "/img.gif?ok")};
  })`);
  assert.equal(after, "loaded", "without the route the image loads");
});

test("abort makes fetch reject", OPTIONS, async () => {
  await page.route("**/api/**", (route) => route.abort());
  const outcome = await run<string>(`async () => { try { await fetch(${JSON.stringify(base + "/api/users")}); return "resolved"; } catch { return "rejected"; } }`);
  assert.equal(outcome, "rejected");
});

test("continue adds a header the server sees", OPTIONS, async () => {
  await page.route("**/echo", (route) => route.continue({ headers: { ...route.request().headers, "x-test": "1" } }));
  const result = await fetchJson("/echo");
  assert.equal((result.body as { headers: Record<string, string> }).headers["x-test"], "1");
});

test("continue can send a navigation to another url", OPTIONS, async () => {
  await page.route(`${base}/navigate-me`, (route) => route.continue({ url: `${base}/real` }));
  await page.navigateTo(`${base}/navigate-me`);
  assert.equal(await page.locator("body").textContent(), "the real page");
  assert.deepEqual(hits.map((hit) => hit.url), ["/real"]);
});

test("continue can change the method", OPTIONS, async () => {
  await page.route("**/echo", (route) => route.continue({ method: "POST" }));
  const result = await fetchJson("/echo");
  assert.equal((result.body as { method: string }).method, "POST");
  assert.deepEqual(hits.map((hit) => `${hit.method} ${hit.url}`), ["POST /echo"]);
});

test("continue can replace the body of a request, also with a longer one", OPTIONS, async () => {
  await page.route("**/echo", (route) => route.continue({ postData: "a much longer replacement body" }));
  const result = await fetchJson("/echo", `{ method: "POST", body: "short" }`);
  assert.equal(result.status, 200);
  assert.equal((result.body as { body: string }).body, "a much longer replacement body");
  assert.equal(hits[0]!.headers["content-length"], String("a much longer replacement body".length));
});

test("continue can replace the body with a shorter one too", OPTIONS, async () => {
  await page.route("**/echo", (route) => route.continue({ postData: "tiny" }));
  const result = await fetchJson("/echo", `{ method: "POST", body: "a rather long original body" }`);
  assert.equal((result.body as { body: string }).body, "tiny");
});

test("a redirect hop is routed on its own", OPTIONS, async () => {
  await page.route(`${base}/api/users`, (route) => route.fulfill({ json: "mocked after redirect" }));
  const result = await fetchJson("/redirect");
  assert.equal(result.body, "mocked after redirect");
  assert.deepEqual(hits.map((hit) => hit.url), ["/redirect"], "only the first hop reached the server");
});

test("a page can be mocked: navigating to a routed url shows the mocked document", OPTIONS, async () => {
  await page.route(`${base}/mocked-page`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><body id='b'>mocked document</body>" }),
  );
  await page.navigateTo(`${base}/mocked-page`);
  assert.equal(await page.locator("body[@id='b']").textContent(), "mocked document");
  assert.deepEqual(hits, []);
  await page.navigateTo(`${base}/real`);
});

test("requests of an iframe are routed too", OPTIONS, async () => {
  await page.route(`${base}/api/users`, (route) => route.fulfill({ json: [{ from: "mock in frame" }] }));
  const message = await run<string>(`() => new Promise((resolve) => {
    window.addEventListener("message", (event) => resolve(event.data), { once: true });
    const frame = document.createElement("iframe");
    frame.src = ${JSON.stringify(base + "/frame")};
    document.body.appendChild(frame);
  })`);
  assert.deepEqual(JSON.parse(message), [{ from: "mock in frame" }]);
  assert.ok(!hits.some((hit) => hit.url === "/api/users"), "the frame's fetch was mocked");
});

test("a handler that does not answer lets the request through instead of hanging", OPTIONS, async () => {
  await page.route("**/echo", () => {});
  const result = await fetchJson("/echo");
  assert.equal((result.body as { method: string }).method, "GET");
  assert.equal(hits.length, 1);
});

test("fallback passes to an older route; the newest is asked first", OPTIONS, async () => {
  await page.route("**/api/users", (route) => route.fulfill({ json: "older" }));
  await page.route("**/api/*", (route) => route.fallback());
  assert.equal((await fetchJson("/api/users")).body, "older");
  await page.route("**/api/users", (route) => route.fulfill({ json: "newest" }));
  assert.equal((await fetchJson("/api/users")).body, "newest");
});

test("unroute stops the mocking", OPTIONS, async () => {
  const handler = (route: { fulfill(o: { json: unknown }): Promise<void> }) => route.fulfill({ json: "mocked" });
  await page.route(`${base}/api/users`, handler);
  assert.equal((await fetchJson("/api/users")).body, "mocked");
  await page.unroute(`${base}/api/users`, handler);
  assert.deepEqual((await fetchJson("/api/users")).body, [{ id: 99, from: "server" }]);
});

test("a request held by a handler keeps the network busy until it is answered", OPTIONS, async () => {
  await page.route("**/slow-mock", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ json: "late" });
  });
  await run(`() => { fetch(${JSON.stringify(base + "/slow-mock")}); }`);
  const started = Date.now();
  await page.waitForNetworkIdle({ idleTime: 100, timeout: 10000 });
  assert.ok(Date.now() - started >= 350, `idle came while the request was held: ${Date.now() - started}ms`);
});

test("a handler that throws fails the request and is reported", OPTIONS, async () => {
  await page.route("**/echo", () => {
    throw new Error("handler bug");
  });
  const outcome = await run<string>(`async () => { try { await fetch(${JSON.stringify(base + "/echo")}); return "resolved"; } catch { return "rejected"; } }`);
  assert.equal(outcome, "rejected");
  assert.equal(page.routeErrors().length, 1);
  assert.match(page.routeErrors()[0]!.message, /handler bug/);
});
