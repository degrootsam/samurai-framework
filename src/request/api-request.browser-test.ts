import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttps } from "node:https";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { runTests } from "../runner/run.js";
import { browserConfig, testBrowser } from "../testing/test-browser.js";
import { request } from "./request.js";

const OPTIONS = { timeout: 120000 };
let server: Server;
let base = "";
let browser: Browser;
let page: Page;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const reply = (headers: Record<string, string | string[]>, body = "") =>
      void res.writeHead(200, headers).end(body);
    switch (url.pathname) {
      case "/whoami":
        return reply(
          { "content-type": "text/plain" },
          req.headers.cookie ?? "",
        );
      case "/team":
        return reply({}, String(req.headers["x-team"]));
      case "/login":
        return reply({
          "set-cookie": [
            "sid=s1; Path=/",
            "secret=h1; Path=/; HttpOnly",
            "scoped=p1; Path=/only",
          ],
        });
      case "/logout":
        return reply({ "set-cookie": ["sid=; Path=/; Max-Age=0"] });
      case "/redirect-set":
        res.writeHead(302, {
          location: "/whoami",
          "set-cookie": "hop=h1; Path=/",
        });
        return void res.end();
      default:
        return reply(
          { "content-type": "text/html" },
          "<!doctype html><body>page</body>",
        );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9470,
    headless: true,
  }));
  await page.navigateTo(`${base}/`, "complete");
});

after(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const names = async () =>
  (await page.context().cookies()).map((c) => c.name).sort();

test(
  "page.request is context.request, and a cookie the page sets is sent by request.get",
  OPTIONS,
  async () => {
    assert.equal(page.request, page.context().request);
    await page.evaluate(`() => { document.cookie = "fromPage=1; path=/"; }`);
    await page.context().addCookies([
      { name: "fromApi", value: "2", url: base, httpOnly: true },
      { name: "otherPath", value: "3", url: base, path: "/nowhere" },
    ]);
    const text = await (await page.request.get(`${base}/whoami`)).text();
    const sent = text.split("; ").sort();
    assert.deepEqual(sent, ["fromApi=2", "fromPage=1"]);
  },
);

test(
  "Set-Cookie of request.post reaches the page: document.cookie, context cookies and a navigation",
  OPTIONS,
  async () => {
    const res = await page.request.post(`${base}/login`);
    assert.equal(res.status(), 200);
    const cookies = await page.context().cookies();
    const secret = cookies.find((c) => c.name === "secret");
    assert.equal(secret?.httpOnly, true);
    assert.equal(cookies.find((c) => c.name === "sid")?.value, "s1");
    assert.equal(cookies.find((c) => c.name === "scoped")?.path, "/only");
    const visible = await page.evaluate<string>(`() => document.cookie`);
    assert.match(visible, /sid=s1/);
    assert.doesNotMatch(visible, /secret=/);
    await page.navigateTo(`${base}/whoami`, "complete");
    const shown = await page.evaluate<string>(`() => document.body.innerText`);
    assert.match(shown, /sid=s1/);
    assert.match(shown, /secret=h1/);
    assert.doesNotMatch(shown, /scoped=/);
    await page.navigateTo(`${base}/`, "complete");
  },
);

test(
  "a Set-Cookie on a redirect hop is stored, and a cookie the site deletes is removed",
  OPTIONS,
  async () => {
    const res = await page.request.get(`${base}/redirect-set`);
    assert.match(await res.text(), /hop=h1/);
    assert.ok((await names()).includes("hop"));
    assert.ok((await names()).includes("sid"));
    await page.request.get(`${base}/logout`);
    assert.ok(!(await names()).includes("sid"));
    assert.ok((await names()).includes("hop"));
  },
);

test(
  "another context is a separate session; its request sees none of these cookies",
  OPTIONS,
  async () => {
    const other = await browser.newContext();
    try {
      assert.equal(
        await (await other.request.get(`${base}/whoami`)).text(),
        "",
      );
      await other.request.get(`${base}/login`);
      assert.ok((await other.cookies()).some((c) => c.name === "sid"));
      assert.ok(
        (await page.context().cookies()).every((c) => c.name !== "sid"),
      );
      await other.close();
      assert.throws(() => other.request, /^Error: context closed$/);
    } finally {
      await other.close();
    }
  },
);

test(
  "a standalone request context keeps its own cookies, apart from the browser",
  OPTIONS,
  async () => {
    await page.context().clearCookies();
    const api = await request.newContext({ baseURL: base });
    await api.get("/login");
    assert.match(await (await api.get("/whoami")).text(), /sid=s1/);
    assert.deepEqual(await names(), []);
    const other = await browser.newContext();
    try {
      await other.addCookies(
        (await api.storageState()).cookies!.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path ?? "/",
        })),
      );
      assert.match(
        await (await other.request.get(`${base}/whoami`)).text(),
        /secret=h1/,
      );
    } finally {
      await other.close();
      await api.dispose();
    }
  },
);

const openssl = spawnSync("openssl", ["version"]);
test(
  "https with a self-signed certificate: refused, unless ignoreHTTPSErrors (also through use.acceptInsecureCerts and newContext)",
  { ...OPTIONS, skip: openssl.status !== 0 && "openssl is not installed" },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-api-cert-"));
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
        res
          .writeHead(200, { "set-cookie": "tls=1; Path=/; Secure" })
          .end("secure"),
    );
    await new Promise<void>((resolve) => https.listen(0, "127.0.0.1", resolve));
    const url = `https://127.0.0.1:${(https.address() as AddressInfo).port}/`;
    const lenient = await browser.newContext({ acceptInsecureCerts: true });
    try {
      const strict = await request.newContext();
      await assert.rejects(
        strict.get(url),
        /^Error: fetch\(\): (DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE) /,
      );
      assert.equal(
        await (await strict.get(url, { ignoreHTTPSErrors: true })).text(),
        "secure",
      );
      const open = await request.newContext({ ignoreHTTPSErrors: true });
      assert.equal(await (await open.get(url)).text(), "secure");
      assert.equal(await (await lenient.request.get(url)).text(), "secure");
      await assert.rejects(page.request.get(url), /^Error: fetch\(\): /);
    } finally {
      await lenient.close();
      await new Promise((resolve) => https.close(resolve));
    }
  },
);

test(
  "the request fixture, test.use extraHTTPHeaders and page.request in a spec",
  OPTIONS,
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-api-fixture-"));
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      `export default ${JSON.stringify({ srcDir: "./specs", timeout: 40000, forbidOnly: false, baseURL: base, ...browserConfig() })};`,
    );
    mkdirSync(path.join(dir, "specs"));
    writeFileSync(
      path.join(dir, "specs/api.spec.ts"),
      `import { test, expect } from ${JSON.stringify(path.resolve("src/api.ts"))};
test.use({ extraHTTPHeaders: { "x-team": "blue" } });
test("request fixture", async ({ request, page, context }) => {
  await request.post("/login");
  expect(await (await request.get("/whoami")).text()).toContain("sid=s1");
  // its cookies are its own: the browser context has none of them
  expect(await context.cookies()).toEqual([]);
  await page.goto("/");
  await page.request.post("/login");
  expect(await page.evaluate("() => document.cookie")).toContain("sid=s1");
  expect(await (await request.get("/team")).text()).toBe("blue");
  expect(await (await page.request.get("/team")).text()).toBe("blue");
  const res = await request.get("/whoami", { failOnStatusCode: true });
  expect(res.ok()).toBe(true);
});
const extended = test.extend<{ api: string }>({
  api: async ({ request }, use) => {
    await request.post("/login");
    await use(await (await request.get("/whoami")).text());
  },
});
extended("request in a custom fixture", async ({ api }) => {
  expect(api).toContain("sid=s1");
});
`,
    );
    const summary = await runTests({
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9471,
      workers: 1,
      reportPath: false,
    });
    assert.deepEqual(
      summary.tests.map((t) => [t.name, t.status]),
      [
        ["request fixture", "success"],
        ["request in a custom fixture", "success"],
      ],
    );
  },
);
