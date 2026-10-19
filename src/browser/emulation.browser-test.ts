import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, before, test } from "node:test";
import { onlyOn, skipOn } from "../testing/test-browser.js";
import { UnsupportedOperationError } from "../transport/unsupported.js";
import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { Browser } from "./browser.js";
import type { BrowserContext } from "./browser-context.js";
import type Page from "./page.js";
import { testBrowser } from "../testing/test-browser.js";

let browser: Browser;
let page: Page;
let server: Server;
let base: string;
const sockets = new Set<Socket>();
const userAgents: string[] = [];
const contexts: BrowserContext[] = [];

before(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/ping")) {
      userAgents.push(String(req.headers["user-agent"]));
      res.setHeader("content-type", "text/plain").end("pong");
      return;
    }
    res
      .setHeader("content-type", "text/html")
      .end(
        `<!doctype html><body>emulation<script>window.__inline = "ran"</script></body>`,
      );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9248,
    headless: true,
  }));
  await page.navigateTo(`${base}/`);
});

after(async () => {
  for (const context of contexts) await context.close().catch(() => undefined);
  await page.dispose();
  await browser?.close();
  sockets.forEach((socket) => socket.destroy());
  await new Promise((resolve) => server.close(resolve));
});

const OPTIONS = { timeout: 40000 };
const connector = (p: Page) =>
  (p as unknown as { biDiConnector: BiDiConnector }).biDiConnector;
const evaluate = <T>(p: Page, source: string) =>
  callFunction<T>(connector(p), p.contextId, source);

async function freshPage(options?: Parameters<Browser["newContext"]>[0]) {
  const context = await browser.newContext(options);
  contexts.push(context);
  const tab = await context.newPage();
  await tab.navigateTo(`${base}/`);
  return { context, tab };
}

test(
  "locale changes navigator.language and Intl formatting, and resets",
  OPTIONS,
  async () => {
    const { tab } = await freshPage();
    const read = () =>
      evaluate<{ language: string; number: string }>(
        tab,
        `() => ({ language: navigator.language, number: new Intl.NumberFormat().format(1234.5) })`,
      );
    // The starting locale is the machine's own, so it is read rather than assumed
    const before = await read();
    await tab.emulate({ locale: "nl-NL" });
    assert.deepEqual(await read(), { language: "nl-NL", number: "1.234,5" });
    await tab.emulate({ locale: null });
    assert.deepEqual(await read(), before);
  },
);

test(
  "timezone changes what Date and Intl report, and resets",
  OPTIONS,
  async () => {
    const { tab } = await freshPage();
    const read = () =>
      evaluate<{ zone: string; offset: number }>(
        tab,
        `() => ({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: new Date(0).getTimezoneOffset() })`,
      );
    const before = await read();
    await tab.emulate({ timezone: "Asia/Tokyo" });
    assert.deepEqual(await read(), { zone: "Asia/Tokyo", offset: -540 });
    await tab.emulate({ timezone: "America/New_York" });
    assert.deepEqual(await read(), { zone: "America/New_York", offset: 300 });
    await tab.emulate({ timezone: null });
    assert.deepEqual(await read(), before);
  },
);

test(
  "userAgent changes navigator.userAgent and the header the server receives",
  OPTIONS,
  async () => {
    const { tab } = await freshPage();
    const original = await evaluate<string>(tab, "() => navigator.userAgent");
    await tab.emulate({ userAgent: "Samurai/1.0 (test)" });
    assert.equal(
      await evaluate<string>(tab, "() => navigator.userAgent"),
      "Samurai/1.0 (test)",
    );
    userAgents.length = 0;
    await evaluate(
      tab,
      `async () => { await fetch(${JSON.stringify(base + "/ping")}); }`,
    );
    assert.deepEqual(userAgents, ["Samurai/1.0 (test)"]);
    await tab.emulate({ userAgent: null });
    assert.equal(
      await evaluate<string>(tab, "() => navigator.userAgent"),
      original,
    );
  },
);

test(
  "offline stops the network, and going online again restores it",
  OPTIONS,
  async () => {
    const { tab } = await freshPage();
    const read = () =>
      evaluate<{ online: boolean; fetch: string }>(
        tab,
        `async () => ({ online: navigator.onLine, fetch: await fetch(${JSON.stringify(base + "/ping")}).then(() => "ok", () => "failed") })`,
      );
    assert.deepEqual(await read(), { online: true, fetch: "ok" });
    await tab.emulate({ offline: true });
    assert.deepEqual(await read(), { online: false, fetch: "failed" });
    await tab.emulate({ offline: false });
    assert.deepEqual(await read(), { online: true, fetch: "ok" });
  },
);

test("orientation changes screen.orientation", OPTIONS, async () => {
  const { tab } = await freshPage();
  await tab.emulate({ orientation: "portrait" });
  assert.equal(
    await evaluate<string>(tab, "() => screen.orientation.type"),
    "portrait-primary",
  );
  await tab.emulate({ orientation: "landscape-secondary" });
  assert.equal(
    await evaluate<string>(tab, "() => screen.orientation.type"),
    "landscape-secondary",
  );
  await tab.emulate({ orientation: null });
  assert.equal(
    await evaluate<string>(tab, "() => screen.orientation.type"),
    "landscape-primary",
  );
});

test("screen changes screen.width and screen.height", OPTIONS, async () => {
  const { tab } = await freshPage();
  // Headless Chrome's own screen is 800x600, so the pretend size is one no browser has
  const size = () =>
    evaluate<number[]>(tab, "() => [screen.width, screen.height]");
  const original = await size();
  await tab.emulate({ screen: { width: 1111, height: 777 } });
  assert.deepEqual(await size(), [1111, 777]);
  await tab.emulate({ screen: null });
  assert.deepEqual(await size(), original);
});

test(
  "geolocation answers once the permission is granted",
  OPTIONS,
  async () => {
    const { tab } = await freshPage();
    const position = () =>
      evaluate<{
        lat?: number;
        lon?: number;
        accuracy?: number;
        error?: string;
      }>(
        tab,
        `() => new Promise((resolve) => navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
        (e) => resolve({ error: e.code + " " + e.message }),
        { timeout: 4000, maximumAge: 0 }))`,
      );
    await tab.grantPermission("geolocation");
    await tab.emulate({
      geolocation: { latitude: 52.37, longitude: 4.9, accuracy: 10 },
    });
    assert.deepEqual(await position(), { lat: 52.37, lon: 4.9, accuracy: 10 });
    await tab.emulate({ geolocation: { latitude: -33.87, longitude: 151.21 } });
    const sydney = await position();
    assert.deepEqual([sydney.lat, sydney.lon], [-33.87, 151.21]);
  },
);

test(
  "a context's emulation reaches its pages, also the ones opened later; other contexts are untouched",
  OPTIONS,
  async () => {
    const language = (p: Page) =>
      evaluate<string>(p, "() => navigator.language");
    const ownLanguage = await language(page);
    const { context, tab } = await freshPage({ locale: "de-DE" });
    assert.equal(
      await language(tab),
      "de-DE",
      "options given to newContext are in place for its first page",
    );
    await context.emulate({ locale: "es-ES" });
    assert.equal(await language(tab), "es-ES", "an open page follows a change");
    const later = await context.newPage();
    await later.navigateTo(`${base}/`);
    assert.equal(
      await language(later),
      "es-ES",
      "a page opened later is emulated too",
    );
    assert.equal(
      await language(page),
      ownLanguage,
      "the default context is not",
    );
  },
);

test(
  "a page's own emulation wins over its context's, and null falls back to the context",
  OPTIONS,
  async () => {
    const { context, tab } = await freshPage({ locale: "de-DE" });
    const language = () => evaluate<string>(tab, "() => navigator.language");
    await tab.emulate({ locale: "fr-FR" });
    assert.equal(await language(), "fr-FR");
    await tab.emulate({ locale: null });
    assert.equal(await language(), "de-DE");
    void context;
  },
);

onlyOn(
  "firefox",
  "Chrome supports touch and javaScriptEnabled (spec 05)",
  "touch and javaScriptEnabled are reported as unsupported by this Firefox, after what came before them was applied",
  OPTIONS,
  async () => {
    const { tab } = await freshPage();
    await assert.rejects(
      tab.emulate({ locale: "it-IT", touch: 5 }),
      (err: unknown) => {
        assert.ok(err instanceof UnsupportedOperationError);
        assert.equal((err as { option?: string }).option, "touch");
        assert.deepEqual((err as { applied?: string[] }).applied, ["locale"]);
        return true;
      },
    );
    assert.equal(
      await evaluate<string>(tab, "() => navigator.language"),
      "it-IT",
      "nothing is rolled back",
    );
    await assert.rejects(
      tab.emulate({ javaScriptEnabled: false }),
      UnsupportedOperationError,
    );
  },
);

skipOn(
  "firefox",
  "Firefox does not support touch and javaScriptEnabled",
  "touch and javaScriptEnabled take effect",
  OPTIONS,
  async () => {
    const { tab } = await freshPage();
    await tab.emulate({ touch: 5 });
    assert.equal(
      await evaluate<number>(tab, "() => navigator.maxTouchPoints"),
      5,
    );
    await tab.emulate({ touch: null });
    assert.equal(
      await evaluate<number>(tab, "() => navigator.maxTouchPoints"),
      0,
    );
    const ran = () =>
      evaluate<string | undefined>(tab, "() => window.__inline");
    await tab.emulate({ javaScriptEnabled: false });
    await tab.reload();
    assert.equal(await ran(), undefined, "the page's own script did not run");
    await tab.emulate({ javaScriptEnabled: true });
    await tab.reload();
    assert.equal(await ran(), "ran");
  },
);

onlyOn(
  "firefox",
  "Chrome supports touch (spec 05)",
  "newContext refuses an unsupported option and leaves no context behind",
  OPTIONS,
  async () => {
    const before = browser.contexts().length;
    await assert.rejects(
      browser.newContext({ locale: "nl-NL", touch: 3 }),
      UnsupportedOperationError,
    );
    assert.equal(browser.contexts().length, before);
    await assert.rejects(
      browser.newContext({ timezone: "Not/AZone" }),
      RangeError,
    );
    assert.equal(browser.contexts().length, before);
  },
);

skipOn(
  "firefox",
  "Firefox does not support touch",
  "newContext applies every option Chrome supports",
  OPTIONS,
  async () => {
    const context = await browser.newContext({ locale: "nl-NL", touch: 3 });
    contexts.push(context);
    const tab = await context.newPage();
    await tab.navigateTo(`${base}/`);
    assert.equal(
      await evaluate<string>(tab, "() => navigator.language"),
      "nl-NL",
    );
    assert.equal(
      await evaluate<number>(tab, "() => navigator.maxTouchPoints"),
      3,
    );
  },
);

test(
  "newContext refuses an invalid option and leaves no context behind",
  OPTIONS,
  async () => {
    const before = browser.contexts().length;
    await assert.rejects(
      browser.newContext({ timezone: "Not/AZone" }),
      RangeError,
    );
    assert.equal(browser.contexts().length, before);
  },
);

test(
  "invalid values are refused by the framework before the browser is asked",
  OPTIONS,
  async () => {
    const { tab } = await freshPage();
    await assert.rejects(
      tab.emulate({ geolocation: { latitude: 100, longitude: 0 } }),
      RangeError,
    );
    await assert.rejects(tab.emulate({ timezone: "Mars/Olympus" }), RangeError);
  },
);
