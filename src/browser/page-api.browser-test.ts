import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { UnsupportedOperationError } from "../locator/selector-errors.js";
import { callFunction } from "../script/call-function.js";
import { setContent } from "../testing/browser-fixture.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { Browser } from "./browser.js";
import type Page from "./page.js";

let browser: Browser;
let page: Page;
let server: Server;
let base: string;
const sockets = new Set<Socket>();
let requests = 0;
const dir = mkdtempSync(path.join(tmpdir(), "samurai-page-api-"));

before(async () => {
  server = createServer((req, res) => {
    requests++;
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("content-type", "text/html").setHeader("cache-control", "no-store").end(
      `<!doctype html><title>Title ${url.pathname}</title><body style="margin:0">` +
        `<div id="tall" style="width:200px;height:3000px;background:linear-gradient(red,blue)">${url.pathname} hit ${requests}</div>` +
        `<div id="card" style="position:absolute;top:100px;left:20px;width:120px;height:80px;background:#3a7"></div></body>`,
    );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  ({ browser, page } = await Browser.launch("firefox", { port: 9244, headless: true }));
  await page.navigateTo(`${base}/one`);
});

after(async () => {
  await page.dispose();
  await browser?.close();
  sockets.forEach((socket) => socket.destroy());
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const OPTIONS = { timeout: 40000 };
const connector = () => (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector;
const run = <T>(source: string) => callFunction<T>(connector(), page.contextId, source);
const size = () => run<[number, number, number]>("() => [innerWidth, innerHeight, devicePixelRatio]");
const png = (image: Buffer) => ({
  magic: image.subarray(0, 8).toString("hex"),
  width: image.readUInt32BE(16),
  height: image.readUInt32BE(20),
});
const PNG_MAGIC = "89504e470d0a1a0a";

test("a page opens at the default viewport, 1280x720", OPTIONS, async () => {
  assert.deepEqual((await size()).slice(0, 2), [1280, 720]);
});

test("setViewport changes the size and the pixel ratio, null puts the browser's size back", OPTIONS, async () => {
  await page.setViewport({ width: 400, height: 300 });
  assert.deepEqual(await size(), [400, 300, 1]);
  await page.setViewport({ width: 500, height: 320, devicePixelRatio: 2 });
  assert.deepEqual(await size(), [500, 320, 2]);
  await page.setViewport(null);
  const reset = await size();
  assert.notDeepEqual(reset.slice(0, 2), [500, 320]);
  await page.applyDefaultViewport();
  assert.deepEqual((await size()).slice(0, 2), [1280, 720]);
});

test("screenshot returns a PNG of the viewport, with the viewport's size", OPTIONS, async () => {
  await page.setViewport({ width: 400, height: 300 });
  const image = await page.screenshot();
  assert.deepEqual(png(image), { magic: PNG_MAGIC, width: 400, height: 300 });
});

test("a device pixel ratio of 2 doubles the image", OPTIONS, async () => {
  await page.setViewport({ width: 400, height: 300, devicePixelRatio: 2 });
  assert.deepEqual(png(await page.screenshot()), { magic: PNG_MAGIC, width: 800, height: 600 });
  await page.setViewport(null); // an omitted ratio keeps the current one, so put both back
  await page.applyDefaultViewport();
});

test("fullPage captures the whole document", OPTIONS, async () => {
  await page.setViewport({ width: 400, height: 300 });
  const { width, height } = png(await page.screenshot({ fullPage: true }));
  assert.ok(width > 350 && width <= 400, `width ${width} (a scrollbar takes some of the 400)`);
  assert.ok(height >= 3000, `height ${height}`);
});

test("clip captures a box, in viewport or document coordinates", OPTIONS, async () => {
  await page.setViewport({ width: 400, height: 300 });
  assert.deepEqual(png(await page.screenshot({ clip: { x: 10, y: 20, width: 50, height: 60 } })), { magic: PNG_MAGIC, width: 50, height: 60 });
  const inDocument = png(await page.screenshot({ fullPage: true, clip: { x: 0, y: 2000, width: 40, height: 70 } }));
  assert.deepEqual([inDocument.width, inDocument.height], [40, 70]);
});

test("jpeg is a JPEG, and a lower quality is smaller", OPTIONS, async () => {
  await page.setViewport({ width: 400, height: 300 });
  const high = await page.screenshot({ type: "jpeg", quality: 95 });
  const low = await page.screenshot({ type: "jpeg", quality: 5 });
  assert.equal(high.subarray(0, 3).toString("hex"), "ffd8ff");
  assert.equal(low.subarray(0, 3).toString("hex"), "ffd8ff");
  assert.ok(low.length < high.length, `q5 ${low.length} bytes vs q95 ${high.length} bytes`);
});

test("path writes the screenshot, folders included", OPTIONS, async () => {
  const file = path.join(dir, "shots", "home.png");
  const image = await page.screenshot({ path: file });
  assert.ok(existsSync(file));
  assert.deepEqual([...readFileSync(file)], [...image]);
});

test("a locator's screenshot is the size of its element", OPTIONS, async () => {
  await page.setViewport({ width: 400, height: 300 });
  const image = await page.locator("div[@id='card']").screenshot({ timeout: 5000 });
  assert.deepEqual(png(image), { magic: PNG_MAGIC, width: 120, height: 80 });
});

test("a locator's screenshot scrolls an element below the fold into view", OPTIONS, async () => {
  await setContent(page, `<div style="height:2000px"></div><div id="low" style="width:90px;height:50px;background:#c33"></div>`);
  await page.setViewport({ width: 400, height: 300 });
  const image = await page.locator("div[@id='low']").screenshot({ timeout: 5000 });
  assert.deepEqual(png(image), { magic: PNG_MAGIC, width: 90, height: 50 });
  await page.navigateTo(`${base}/one`);
});

/** The page box of the first page, looked up in the PDF text and in its compressed streams */
function mediaBox(pdf: Buffer): number[] | undefined {
  const pattern = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/;
  const raw = pdf.toString("latin1");
  const texts = [raw];
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    const end = raw.indexOf("endstream", start);
    try {
      texts.push(inflateSync(pdf.subarray(start, end)).toString("latin1"));
    } catch {
      // not a Flate stream
    }
  }
  for (const text of texts) {
    const found = pattern.exec(text);
    if (found) return [Math.round(Number(found[3]) - Number(found[1])), Math.round(Number(found[4]) - Number(found[2]))];
  }
  return undefined;
}

test("pdf returns a PDF with the requested paper size", OPTIONS, async () => {
  const a4 = await page.pdf({ format: "A4" });
  assert.equal(a4.subarray(0, 5).toString(), "%PDF-");
  const near = (actual: number[] | undefined, expected: number[]) =>
    assert.ok(actual && actual.every((value, i) => Math.abs(value - expected[i]!) <= 2), `${actual} is not about ${expected}`);
  near(mediaBox(a4), [595, 842]);
  near(mediaBox(await page.pdf({ format: "A4", landscape: true })), [842, 595]);
  near(mediaBox(await page.pdf({ format: "Letter" })), [612, 792]);
  const file = path.join(dir, "pdfs", "page.pdf");
  await page.pdf({ path: file });
  assert.equal(readFileSync(file).subarray(0, 5).toString(), "%PDF-");
});

test("url and title describe the page now", OPTIONS, async () => {
  await page.navigateTo(`${base}/titled`);
  assert.equal(await page.url(), `${base}/titled`);
  assert.equal(await page.title(), "Title /titled");
});

test("goBack and goForward walk the history; at the ends they say false", OPTIONS, async () => {
  const tab = await browser.newPage({ type: "tab" }); // its initial about:blank is not a history entry
  try {
    await tab.navigateTo(`${base}/first`);
    await tab.navigateTo(`${base}/second`);
    assert.equal(await tab.goBack(), true);
    assert.equal(await tab.url(), `${base}/first`);
    assert.equal(await tab.goForward(), true);
    assert.equal(await tab.url(), `${base}/second`);
    assert.equal(await tab.goForward(), false, "nothing ahead");
    assert.equal(await tab.goBack(), true);
    assert.equal(await tab.goBack(), false, "nothing behind the first page");
    assert.equal(await tab.goBack(), false, "however often it is asked");
    assert.equal(await tab.url(), `${base}/first`);
    assert.equal(await tab.goForward(), true, "and the way forward is still there");
    assert.equal(await tab.url(), `${base}/second`);
  } finally {
    await tab.close();
  }
});

test("reload fetches the page again and waits for it", OPTIONS, async () => {
  await page.navigateTo(`${base}/reloaded`);
  const before = requests;
  const result = await page.reload();
  assert.ok(requests > before, "the server was asked again");
  assert.equal(result.url, `${base}/reloaded`);
  assert.equal(typeof result.navigation, "string");
  assert.equal(await run("() => document.readyState"), "complete");
});

test("reload({ ignoreCache }) is reported as unsupported by this Firefox", OPTIONS, async () => {
  await assert.rejects(page.reload({ ignoreCache: true }), UnsupportedOperationError);
});

test("close closes a tab; the page then refuses further use", OPTIONS, async () => {
  const tab = await browser.newPage({ type: "tab" });
  await tab.navigateTo(`${base}/tab`);
  assert.equal(await tab.title(), "Title /tab");
  await tab.close();
  assert.equal(tab.closed, true);
  await assert.rejects(tab.url(), /page closed/);
  await assert.rejects(tab.screenshot(), /page closed/);
  await tab.close(); // idempotent
});

test("close({ runBeforeUnload }) works on a page without handlers", OPTIONS, async () => {
  const tab = await browser.newPage({ type: "tab" });
  await tab.navigateTo(`${base}/tab2`);
  await tab.close({ runBeforeUnload: true });
  assert.equal(tab.closed, true);
});
