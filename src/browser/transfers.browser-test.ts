import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callFunction } from "../script/call-function.js";
import { setContent } from "../testing/browser-fixture.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { Browser } from "./browser.js";
import { DownloadError } from "./download.js";
import type Page from "./page.js";

let browser: Browser;
let page: Page;
let server: Server;
let base: string;
let downloadsDir: string;
const sockets = new Set<Socket>();
const uploads = mkdtempSync(path.join(tmpdir(), "samurai-uploads-"));

before(async () => {
  server = createServer((req, res) => {
    const p = (req.url ?? "").split("?")[0];
    if (p === "/file") {
      res.writeHead(200, { "content-type": "text/csv", "content-disposition": 'attachment; filename="report.csv"' }).end("a,b\n1,2\n");
    } else if (p === "/broken") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="broken.bin"', "content-length": "100000" });
      res.write("partial");
      setTimeout(() => res.destroy(), 150);
    } else if (p === "/frame") {
      res.setHeader("content-type", "text/html").end(`<body><a id="dl" href="/file">in frame</a></body>`);
    } else {
      res.setHeader("content-type", "text/html").end("<!doctype html><body>page</body>");
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ browser, page } = await Browser.launch("firefox", { port: 9250, headless: true }));
  downloadsDir = browser.downloadsDir!;
  await page.navigateTo(`${base}/`);
});

after(async () => {
  await page.dispose();
  await browser?.close();
  sockets.forEach((socket) => socket.destroy());
  await new Promise((resolve) => server.close(resolve));
  rmSync(uploads, { recursive: true, force: true });
  if (downloadsDir) rmSync(downloadsDir, { recursive: true, force: true });
});

const OPTIONS = { timeout: 40000 };
const connector = () => (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector;
const evaluate = <T>(source: string) => callFunction<T>(connector(), page.contextId, source);
const upload = (name: string, content = name) => {
  const full = path.join(uploads, name);
  writeFileSync(full, content);
  return full;
};

test("the browser saves downloads in the folder the framework made for it", OPTIONS, async () => {
  assert.ok(downloadsDir, "the browser could be told where to save");
  assert.ok(existsSync(downloadsDir));
  assert.match(path.basename(downloadsDir), /^dl-/);
});

test("waitForDownload reports the download when it starts; path() gives the saved file", OPTIONS, async () => {
  await setContent(page, `<a id="dl" href="${base}/file">download</a>`);
  const download = await page.waitForDownload({ trigger: () => page.locator("a[@id='dl']").click({ timeout: 5000 }) });
  assert.equal(download.suggestedFilename(), "report.csv");
  assert.equal(download.url(), `${base}/file`);
  const file = await download.path();
  assert.equal(path.dirname(file), downloadsDir);
  assert.equal(readFileSync(file, "utf8"), "a,b\n1,2\n");
  assert.equal(await download.failure(), null);
});

test("a second download with the same name is saved under another name", OPTIONS, async () => {
  await setContent(page, `<a id="dl" href="${base}/file?again">download</a>`);
  const download = await page.waitForDownload({ trigger: () => page.locator("a[@id='dl']").click({ timeout: 5000 }) });
  const file = await download.path();
  assert.notEqual(path.basename(file), "report.csv");
  assert.match(path.basename(file), /^report.*\.csv$/);
  assert.ok(readdirSync(downloadsDir).length >= 2);
});

test("a download the server breaks off is cancelled", OPTIONS, async () => {
  await setContent(page, `<a id="broken" href="${base}/broken">broken</a>`);
  const download = await page.waitForDownload({ trigger: () => page.locator("a[@id='broken']").click({ timeout: 5000 }) });
  assert.equal(download.suggestedFilename(), "broken.bin");
  await assert.rejects(download.path(), (err: unknown) => {
    assert.ok(err instanceof DownloadError);
    assert.equal(err.reason, "canceled");
    assert.equal(err.url, `${base}/broken`);
    return true;
  });
  assert.equal(await download.failure(), "canceled");
});

test("a download started from an iframe belongs to the page", OPTIONS, async () => {
  await page.navigateTo(`${base}/?frames`);
  await evaluate(`() => { const f = document.body.appendChild(document.createElement("iframe")); f.src = "/frame"; }`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const seen: string[] = [];
  page.on("download", (download) => seen.push(download.suggestedFilename()));
  // click inside the frame through the script: pointer input is per top-level context
  await evaluate(`() => { document.querySelector("iframe").contentDocument.getElementById("dl").click(); }`);
  const deadline = Date.now() + 5000;
  while (seen.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(seen.length, 1);
  assert.match(seen[0]!, /^report.*\.csv$/, "Firefox's suggested name already carries its (n) suffix when the name is taken");
});

test("waitForDownload times out with a message of its own", OPTIONS, async () => {
  await assert.rejects(page.waitForDownload({ timeout: 300 }), /waitForDownload\(\): no download started within 300ms/);
});

test("a file input's picker is reported, and setFiles fills the input", OPTIONS, async () => {
  await setContent(
    page,
    `<input type="file" id="f"><div id="out"></div>`,
    `const f = document.getElementById("f");
     f.addEventListener("change", () => { document.getElementById("out").textContent = [...f.files].map((x) => x.name).join(","); });`,
  );
  const picture = upload("avatar.png");
  const chooser = await page.waitForFileChooser({ trigger: () => page.locator("input[@id='f']").click({ timeout: 5000 }) });
  assert.equal(chooser.isMultiple(), false);
  await chooser.setFiles(picture);
  assert.equal(await evaluate<string>(`() => document.getElementById("out").textContent`), "avatar.png");
});

test("a picker that takes several files says so, and takes them", OPTIONS, async () => {
  await setContent(page, `<input type="file" id="m" multiple>`);
  const chooser = await page.waitForFileChooser({ trigger: () => page.locator("input[@id='m']").click({ timeout: 5000 }) });
  assert.equal(chooser.isMultiple(), true);
  await chooser.setFiles([upload("a.csv"), upload("b.csv")]);
  assert.deepEqual(await evaluate<string[]>(`() => [...document.getElementById("m").files].map((f) => f.name)`), ["a.csv", "b.csv"]);
});

test("a single-file picker refuses two files", OPTIONS, async () => {
  await setContent(page, `<input type="file" id="f">`);
  const chooser = await page.waitForFileChooser({ trigger: () => page.locator("input[@id='f']").click({ timeout: 5000 }) });
  await assert.rejects(chooser.setFiles([upload("x1.txt"), upload("x2.txt")]), /file chooser does not accept multiple files/);
  await assert.rejects(chooser.setFiles(path.join(uploads, "missing.txt")), /file not found/);
});

test("a click on the label of a hidden input opens the picker as well", OPTIONS, async () => {
  await setContent(page, `<label id="lab" for="f" style="display:inline-block;padding:6px">Choose</label><input type="file" id="f" style="display:none">`);
  const chooser = await page.waitForFileChooser({ trigger: () => page.locator("label[@id='lab']").click({ timeout: 5000 }) });
  await chooser.setFiles(upload("hidden.txt"));
  assert.deepEqual(await evaluate<string[]>(`() => [...document.getElementById("f").files].map((f) => f.name)`), ["hidden.txt"]);
});

test("a picker nobody waits for does not hang the page", OPTIONS, async () => {
  await setContent(page, `<input type="file" id="f"><button id="b">next</button>`);
  await page.locator("input[@id='f']").click({ timeout: 5000 });
  await page.locator("button[@id='b']").click({ timeout: 5000 });
  assert.equal(await page.locator("button[@id='b']").textContent(), "next");
});

test("page.on(filechooser) sees every picker", OPTIONS, async () => {
  await setContent(page, `<input type="file" id="f">`);
  let count = 0;
  page.on("filechooser", () => count++);
  await page.locator("input[@id='f']").click({ timeout: 5000 });
  await page.locator("input[@id='f']").click({ timeout: 5000 });
  const deadline = Date.now() + 3000;
  while (count < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(count, 2);
});

test("waitForFileChooser times out with a message of its own", OPTIONS, async () => {
  await assert.rejects(page.waitForFileChooser({ timeout: 300 }), /waitForFileChooser\(\): no file chooser opened within 300ms/);
});
