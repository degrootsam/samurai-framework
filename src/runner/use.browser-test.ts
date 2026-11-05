import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttps } from "node:https";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { browserConfig, testBrowser } from "../testing/test-browser.js";
import { runTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
const chrome = testBrowser() === "chrome";

let server: Server;
let base = "";
const seen: Array<Record<string, string | undefined>> = [];

before(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/echo")) {
      seen.push({
        feature: req.headers["x-feature"] as string | undefined,
        userAgent: req.headers["user-agent"],
        language: req.headers["accept-language"],
      });
      return void res.setHeader("content-type", "text/plain").end("ok");
    }
    res.setHeader("content-type", "text/html").end(
      `<!doctype html><meta name="viewport" content="width=600"><body>
       <p id="a">static</p><script>document.getElementById("a").textContent = "js ran"</script></body>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** `logJSON(value)` appends a JSON line to `api.log`; `BASE` is the server above */
const HEAD = `
import { appendFileSync } from "node:fs";
import { test, expect } from ${API};
const BASE = ${"process.env.USE_BASE"};
const logJSON = (value) => appendFileSync(process.env.API_LOG, JSON.stringify(value) + "\\n");
const facts = (page) => page.evaluate(\`() => ({
  language: navigator.language,
  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  userAgent: navigator.userAgent,
  dark: matchMedia("(prefers-color-scheme: dark)").matches,
  touch: navigator.maxTouchPoints,
  width: innerWidth,
})\`);
`;

function project(spec: string, config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-use-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({ srcDir: "./specs", timeout: 40000, expect: { timeout: 2000 }, forbidOnly: false, ...browserConfig(), ...config })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(path.join(dir, "specs/use.spec.ts"), HEAD + spec);
  const apiLog = path.join(dir, "api.log");
  writeFileSync(apiLog, "");
  process.env.API_LOG = apiLog;
  process.env.USE_BASE = base;
  return {
    dir,
    json: () =>
      readFileSync(apiLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, any>),
  };
}

async function run(dir: string, port: number) {
  const summary = await runTests({
    projectDir: dir,
    dataDir: path.join(dir, "data"),
    headless: true,
    port,
    workers: 1,
    reportPath: false,
  });
  return summary;
}

const passed = (summary: Awaited<ReturnType<typeof run>>) =>
  assert.deepEqual(
    summary.tests
      .filter((t) => t.status !== "success")
      .map((t) => [t.name, t.status]),
    [],
  );

const LONG = { timeout: 180000 };

test(
  "config use and test.use apply to the page; an inner describe wins; a test outside them is untouched",
  LONG,
  async () => {
    const { dir, json } = project(
      `
test.use({ timezone: "Asia/Tokyo", colorScheme: "dark" });
test("file level", async ({ page }) => {
  await page.navigateTo(BASE + "/");
  logJSON({ name: "file", ...(await facts(page)) });
});
test.describe("nl", () => {
  test.use({ locale: "nl-NL", userAgent: "Samurai/1 (nl)" });
  test("inside", async ({ page }) => {
    await page.navigateTo(BASE + "/");
    logJSON({ name: "nl", ...(await facts(page)) });
  });
});
`,
      { use: { locale: "de-DE", timezone: "Europe/Paris" } },
    );
    passed(await run(dir, 9341));
    const [file, nl] = json();
    assert.equal(file?.language, "de-DE");
    assert.equal(file?.zone, "Asia/Tokyo");
    assert.equal(file?.dark, true);
    assert.equal(nl?.language, "nl-NL");
    assert.equal(nl?.userAgent, "Samurai/1 (nl)");
    assert.equal(nl?.zone, "Asia/Tokyo");
    assert.equal(nl?.dark, true);
  },
);

test(
  "geolocation, offline, orientation and screen are declared like the other options, and page.use() changes them in the test",
  LONG,
  async () => {
    const { dir, json } = project(
      `
test.use({
  geolocation: { latitude: 52.37, longitude: 4.9 },
  orientation: "landscape",
  screen: { width: 800, height: 600 },
});
test("declared", async ({ page }) => {
  await page.navigateTo(BASE + "/");
  await page.grantPermission("geolocation");
  const read = () => page.evaluate(\`() => new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, screen: screen.width + "x" + screen.height, orientation: screen.orientation.type, online: navigator.onLine }),
      (e) => resolve({ error: e.code })))\`);
  const declared = await read();
  await page.use({ offline: true, screen: { width: 640, height: 480 } });
  const changed = await read();
  await page.use({ offline: null, screen: null });
  logJSON({ declared, changed, back: await read() });
});
`,
    );
    passed(await run(dir, 9350));
    const [facts] = json();
    assert.deepEqual(facts?.declared, {
      lat: 52.37,
      lon: 4.9,
      screen: "800x600",
      orientation: "landscape-primary",
      online: true,
    });
    assert.equal(facts?.changed.online, false);
    assert.equal(facts?.changed.screen, "640x480");
    assert.equal(facts?.back.online, true);
  },
);

test(
  "without use, the page is as the browser makes it (also after a run that turned things off)",
  LONG,
  async () => {
    const off = project(
      `
test.use({ javaScriptEnabled: false, colorScheme: "dark" });
test("no scripts", async ({ page }) => {
  await page.navigateTo(BASE + "/");
  logJSON({ text: await page.locator("#a").textContent() });
});
`,
    );
    passed(await run(off.dir, 9342));
    assert.deepEqual(off.json(), [{ text: "static" }]);

    // The same browser profile, now without use: JavaScript runs and the colour scheme is the browser's
    const plain = project(
      `
test("scripts again", async ({ page }) => {
  await page.navigateTo(BASE + "/");
  logJSON({ text: await page.locator("#a").textContent(), ...(await facts(page)) });
});
`,
    );
    passed(await run(plain.dir, 9343));
    const [row] = plain.json();
    assert.equal(row?.text, "js ran");
    assert.equal(row?.dark, false);
  },
);

test(
  "extraHTTPHeaders are sent with every request, and the locale with Accept-Language",
  LONG,
  async () => {
    seen.length = 0;
    const { dir } = project(`
test.use({ extraHTTPHeaders: { "x-feature": "on" }, locale: "nl-NL" });
test("headers", async ({ page }) => {
  await page.navigateTo(BASE + "/");
  await page.evaluate(\`() => fetch("/echo").then((r) => r.text())\`);
});
test.describe("other", () => {
  test.use({ extraHTTPHeaders: { "x-feature": "off" } });
  test("replaced", async ({ page }) => {
    await page.navigateTo(BASE + "/");
    await page.evaluate(\`() => fetch("/echo").then((r) => r.text())\`);
  });
});
`);
    passed(await run(dir, 9344));
    assert.deepEqual(
      seen.map((s) => s.feature),
      ["on", "off"],
    );
    assert.match(seen[0]?.language ?? "", /^nl/);
  },
);

test(
  "hasTouch and isMobile: Chrome applies them, Firefox ignores them and the fixtures say false",
  LONG,
  async () => {
    const { dir, json } = project(`
test.use({ hasTouch: true, isMobile: true });
test("phone", async ({ page, isMobile, hasTouch }) => {
  await page.navigateTo(BASE + "/");
  logJSON({ isMobile, hasTouch, ...(await facts(page)) });
  await page.setViewport({ width: 500, height: 800 });
  logJSON({ afterResize: await page.evaluate("() => innerWidth") });
});
test.describe("desktop", () => {
  test.use({ hasTouch: false, isMobile: false });
  test("desktop", async ({ page, isMobile, hasTouch }) => {
    await page.navigateTo(BASE + "/");
    logJSON({ isMobile, hasTouch, ...(await facts(page)) });
  });
});
`);
    passed(await run(dir, 9345));
    const [phone, resized, desktop] = json();
    assert.equal(desktop?.isMobile, false);
    assert.equal(desktop?.hasTouch, false);
    assert.equal(desktop?.touch, 0);
    assert.equal(desktop?.width, 1280);
    if (chrome) {
      assert.equal(phone?.isMobile, true);
      assert.equal(phone?.hasTouch, true);
      assert.ok(phone?.touch > 0, "maxTouchPoints");
      // The page asks for a layout width of 600 with its viewport meta tag: only a phone follows it
      assert.equal(phone?.width, 600);
      assert.equal(
        resized?.afterResize,
        600,
        "still a phone after setViewport",
      );
    } else {
      assert.equal(phone?.isMobile, false);
      assert.equal(phone?.hasTouch, false);
      assert.equal(phone?.touch, 0);
      assert.equal(phone?.width, 1280);
    }
  },
);

test(
  "storageState (an object and a file) sets cookies and local storage before the test",
  LONG,
  async () => {
    const cookies = [
      {
        name: "session",
        value: "abc",
        domain: "127.0.0.1",
        path: "/",
        expires: -1,
      },
    ];
    const localStorage = [{ name: "token", value: "t-1" }];
    const { dir, json } = project(`
const read = (page) => page.evaluate(\`() => ({ cookie: document.cookie, token: localStorage.getItem("token") })\`);
test.describe("object", () => {
  test.use({ storageState: { cookies: ${JSON.stringify(cookies)}, origins: [{ origin: BASE, localStorage: ${JSON.stringify(localStorage)} }] } });
  test("restored", async ({ page, context }) => {
    await page.navigateTo(BASE + "/");
    logJSON({ from: "object", ...(await read(page)), pages: context.pages().length });
  });
});
test.describe("file", () => {
  test.use({ storageState: "state.json" });
  test("restored", async ({ page }) => {
    await page.navigateTo(BASE + "/");
    logJSON({ from: "file", ...(await read(page)) });
  });
});
`);
    writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({ cookies, origins: [{ origin: base, localStorage }] }),
    );
    passed(await run(dir, 9346));
    const [fromObject, fromFile] = json();
    assert.equal(fromObject?.cookie, "session=abc");
    assert.equal(fromObject?.token, "t-1");
    assert.equal(
      fromObject?.pages,
      1,
      "the scratch tab that wrote local storage is closed",
    );
    assert.equal(fromFile?.cookie, "session=abc");
    assert.equal(fromFile?.token, "t-1");
  },
);

test(
  "a storageState file that is missing fails the test with use(): ...",
  LONG,
  async () => {
    const { dir } = project(`
test.use({ storageState: "nope.json" });
test("missing", async ({ page }) => { await page.navigateTo(BASE + "/"); });
`);
    const summary = await run(dir, 9347);
    assert.equal(summary.tests[0]?.status, "failed");
    assert.match(
      (summary.tests[0] as { message?: string }).message ?? "",
      /use\(\): storageState file "nope\.json" could not be read/,
    );
  },
);

test(
  "contexts and pages a test opens get the same options; options given to newContext win",
  LONG,
  async () => {
    const { dir, json } = project(`
test.use({ locale: "nl-NL", colorScheme: "dark", timezone: "Asia/Tokyo" });
test("more contexts", async ({ page, browser, context }) => {
  const second = await context.newPage();
  await second.navigateTo(BASE + "/");
  const fresh = await browser.newContext();
  const third = await fresh.newPage();
  await third.navigateTo(BASE + "/");
  const explicit = await browser.newContext({ locale: "fr-FR" });
  const fourth = await explicit.newPage();
  await fourth.navigateTo(BASE + "/");
  logJSON({ second: await facts(second), third: await facts(third), fourth: await facts(fourth) });
});
`);
    passed(await run(dir, 9348));
    const [row] = json();
    for (const key of ["second", "third", "fourth"]) {
      assert.equal(row?.[key].dark, true, `${key} colour scheme`);
      assert.equal(row?.[key].zone, "Asia/Tokyo", `${key} timezone`);
    }
    assert.equal(row?.second.language, "nl-NL");
    assert.equal(row?.third.language, "nl-NL");
    assert.equal(row?.fourth.language, "fr-FR");
  },
);

const openssl = spawnSync("openssl", ["version"]);
test(
  "acceptInsecureCerts lets a page open a self-signed https site; without it the navigation fails",
  { ...LONG, skip: openssl.status !== 0 && "openssl is not installed" },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cert-"));
    const key = path.join(dir, "key.pem");
    const cert = path.join(dir, "cert.pem");
    const made = spawnSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-subj",
      "/CN=127.0.0.1",
      "-days",
      "1",
    ]);
    assert.equal(made.status, 0, String(made.stderr));
    const https = createHttps(
      { key: readFileSync(key), cert: readFileSync(cert) },
      (_req, res) =>
        res.setHeader("content-type", "text/html").end("<body>secure</body>"),
    );
    await new Promise<void>((resolve) => https.listen(0, "127.0.0.1", resolve));
    const url = `https://127.0.0.1:${(https.address() as AddressInfo).port}/`;
    try {
      const { dir: project1, json } = project(`
test.describe("lenient", () => {
  test.use({ acceptInsecureCerts: true });
  test("opens", async ({ page }) => {
    await page.navigateTo(${JSON.stringify(url)});
    logJSON({ lenient: await page.locator("body").textContent() });
  });
});
test("strict", async ({ page }) => {
  let failed = false;
  try { await page.navigateTo(${JSON.stringify(url)}); } catch { failed = true; }
  logJSON({ strictFailed: failed });
});
`);
      passed(await run(project1, 9349));
      assert.deepEqual(json(), [{ lenient: "secure" }, { strictFailed: true }]);
    } finally {
      await new Promise((resolve) => https.close(resolve));
    }
  },
);
