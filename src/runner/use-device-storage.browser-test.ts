import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttps } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { testBrowser } from "../testing/test-browser.js";
import {
  LONG,
  passed,
  project,
  run,
  serverBase,
  useServer,
} from "../testing/use-setup.js";

const chrome = testBrowser() === "chrome";

useServer();

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
      JSON.stringify({
        cookies,
        origins: [{ origin: serverBase(), localStorage }],
      }),
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
