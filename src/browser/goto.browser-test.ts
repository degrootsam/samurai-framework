import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, before, test } from "node:test";
import { Browser } from "./browser.js";
import type Page from "./page.js";

let browser: Browser;
let page: Page;
let server: Server;
let base: string;
const sockets = new Set<Socket>();

before(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html").end(`<!doctype html><title>${req.url}</title>`);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ browser, page } = await Browser.launch("firefox", { port: 9251, headless: true }, AbortSignal.timeout(30000)));
});

after(async () => {
  try {
    await page?.dispose().catch(() => {});
    await browser?.close().catch(() => {});
  } finally {
    sockets.forEach((socket) => socket.destroy());
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});

test("goto resolves a path against the base URL", { timeout: 40000 }, async () => {
  page.setBaseURL(`${base}/shop/`);
  await page.goto("/products?id=1");
  assert.equal(await page.url(), `${base}/products?id=1`);
  assert.equal(await page.title(), "/products?id=1");
  await page.goto("./cart");
  assert.equal(await page.url(), `${base}/shop/cart`);
});
