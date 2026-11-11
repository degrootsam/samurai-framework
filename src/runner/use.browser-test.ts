import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LONG,
  passed,
  project,
  run,
  seen,
  useServer,
} from "../testing/use-setup.js";

useServer();

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
