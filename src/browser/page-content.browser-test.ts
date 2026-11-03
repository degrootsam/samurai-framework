import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, before, test } from "node:test";
import { testBrowser } from "../testing/test-browser.js";
import { Browser } from "./browser.js";
import { UrlTimeoutError } from "./navigation-error.js";
import type Page from "./page.js";

let browser: Browser;
let page: Page;
let server: Server;
let base: string;
const sockets = new Set<Socket>();

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (type: string, body: string, delay = 0) =>
      setTimeout(
        () =>
          res
            .setHeader("content-type", type)
            .setHeader("cache-control", "no-store")
            .end(body),
        delay,
      );
    if (url.pathname === "/slow.js") {
      send("text/javascript", "window.__slow = 'loaded';", 400);
    } else if (url.pathname === "/slow.png") {
      send("image/png", "", 600);
    } else if (url.pathname === "/with-image") {
      send(
        "text/html",
        `<!doctype html><title>img</title><img src="/slow.png">`,
      );
    } else {
      send(
        "text/html",
        `<!doctype html><title>${url.pathname}</title><p>${url.pathname}</p>`,
      );
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9453,
    headless: true,
  }));
  await page.navigateTo(`${base}/start`, "complete");
});

after(async () => {
  await browser?.close();
  sockets.forEach((socket) => socket.destroy());
  await new Promise((resolve) => server.close(resolve));
});

const OPTIONS = { timeout: 30000 };

test(
  "setContent and content round trip, with styles and scripts",
  OPTIONS,
  async () => {
    await page.setContent(
      `<!doctype html><html><head><title>Set title</title><style>#p { color: rgb(255, 0, 0); }</style></head>` +
        `<body><p id="p">hello</p><script>document.getElementById("p").dataset.ran = "yes"; window.__count = (window.__count || 0) + 1;</script></body></html>`,
    );
    assert.equal(await page.title(), "Set title");
    assert.equal(
      await page.evaluate(
        "getComputedStyle(document.getElementById('p')).color",
      ),
      "rgb(255, 0, 0)",
    );
    assert.equal(
      await page.evaluate("document.getElementById('p').dataset.ran"),
      "yes",
    );
    assert.equal(
      await page.evaluate("window.__count"),
      1,
      "the script ran once",
    );
    assert.equal(await page.locator("p[@id='p']").textContent(), "hello");

    const html = await page.content();
    assert.ok(html.startsWith("<!DOCTYPE html>"), html.slice(0, 40));
    assert.match(html, /<title>Set title<\/title>/);
    assert.match(html, /<p id="p" data-ran="yes">hello<\/p>/);
    assert.match(html, /<script>document\.getElementById/);
  },
);

test("content reflects changes made by scripts", OPTIONS, async () => {
  await page.setContent(`<p id="p">a</p>`);
  await page.evaluate("document.getElementById('p').textContent = 'b'");
  assert.match(await page.content(), /<p id="p">b<\/p>/);
});

test(
  "setContent replaces the earlier document and keeps the page's URL",
  OPTIONS,
  async () => {
    await page.setContent(`<p id="one">first</p>`);
    await page.setContent(`<p id="two">second</p>`);
    assert.equal(await page.locator("p[@id='one']").count(), 0);
    assert.equal(await page.locator("p[@id='two']").textContent(), "second");
    assert.equal(await page.url(), `${base}/start`);
  },
);

test(
  "setContent waits for the load: a script that loads slowly has run",
  OPTIONS,
  async () => {
    await page.setContent(`<p>x</p><script src="${base}/slow.js"></script>`);
    assert.equal(await page.evaluate("window.__slow"), "loaded");
    assert.equal(await page.evaluate("document.readyState"), "complete");
  },
);

test("setContent can stop at DOMContentLoaded", OPTIONS, async () => {
  await page.setContent(`<p>x</p><img src="${base}/slow.png">`, {
    waitUntil: "domcontentloaded",
  });
  assert.notEqual(await page.evaluate("document.readyState"), "loading");
});

test(
  "setContent fails when the load does not come in time",
  OPTIONS,
  async () => {
    await assert.rejects(
      page.setContent(`<img src="${base}/slow.png">`, { timeout: 100 }),
      /did not finish within 100ms/,
    );
    await page.waitForLoadState("load");
  },
);

test(
  "waitForURL waits for a string, a glob, a RegExp and a function",
  OPTIONS,
  async () => {
    await page.navigateTo(`${base}/start`, "complete");
    const goTo = (path: string) =>
      page.evaluate(
        `setTimeout(() => { location.href = ${JSON.stringify(path)}; }, 150)`,
      );

    await goTo("/glob");
    await page.waitForURL("**/glob");
    assert.equal(await page.url(), `${base}/glob`);

    await goTo("/regexp");
    await page.waitForURL(/\/regexp$/);

    await goTo("/function?x=1");
    await page.waitForURL(
      (url) =>
        url.pathname === "/function" && url.searchParams.get("x") === "1",
    );

    await goTo("/exact");
    await page.waitForURL(`${base}/exact`);
  },
);

test(
  "waitForURL sees a pushState, and resolves at once when the URL already matches",
  OPTIONS,
  async () => {
    await page.evaluate(
      "setTimeout(() => history.pushState({}, '', '/pushed'), 150)",
    );
    await page.waitForURL(/\/pushed$/);
    assert.equal(await page.url(), `${base}/pushed`);
    const started = Date.now();
    await page.waitForURL("**/pushed");
    assert.ok(Date.now() - started < 3000);
  },
);

test(
  "waitForURL resolves a slash-led string against the base URL",
  OPTIONS,
  async () => {
    page.setBaseURL(base);
    try {
      await page.evaluate(
        "setTimeout(() => { location.href = '/based'; }, 100)",
      );
      await page.waitForURL("/based");
    } finally {
      page.setBaseURL(undefined);
    }
  },
);

test("waitForURL then waits for the load state", OPTIONS, async () => {
  await page.evaluate(
    "setTimeout(() => { location.href = '/with-image'; }, 100)",
  );
  await page.waitForURL("**/with-image");
  assert.equal(await page.evaluate("document.readyState"), "complete");
});

test(
  "waitForURL times out with the last URL in the message",
  OPTIONS,
  async () => {
    await page.navigateTo(`${base}/stuck`, "complete");
    await assert.rejects(
      page.waitForURL("**/never", { timeout: 300 }),
      (err: Error) => {
        assert.ok(err instanceof UrlTimeoutError);
        assert.match(err.message, /\/stuck/);
        return true;
      },
    );
  },
);

test(
  "viewportSize starts at the default, follows setViewportSize and is null after a reset",
  OPTIONS,
  async () => {
    assert.deepEqual(page.viewportSize(), { width: 1280, height: 720 });
    await page.setViewportSize({ width: 500, height: 400 });
    assert.deepEqual(page.viewportSize(), { width: 500, height: 400 });
    assert.deepEqual(
      await page.evaluate("[innerWidth, innerHeight]"),
      [500, 400],
    );
    await page.setViewport({ width: 640, height: 480 });
    assert.deepEqual(page.viewportSize(), { width: 640, height: 480 });
    await page.setViewport(null);
    assert.equal(page.viewportSize(), null);
    await page.setViewportSize({ width: 1280, height: 720 });
  },
);

test("a page opened later has the default size too", OPTIONS, async () => {
  const other = await browser.newPage({ type: "tab" });
  try {
    assert.deepEqual(other.viewportSize(), { width: 1280, height: 720 });
    assert.deepEqual(
      await other.evaluate("[innerWidth, innerHeight]"),
      [1280, 720],
    );
  } finally {
    await other.close();
  }
});
