import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { callFunction } from "./call-function.js";
import { HELPER_SANDBOX } from "./helpers.js";

let browser: Browser;
let page: Page;
let connector: BiDiConnector;
/** Commands sent to the browser, by method, to count registrations */
const sentMethods: string[] = [];

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", { port: 9234, headless: true }));
  connector = (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector;
  const send = connector.send.bind(connector);
  connector.send = ((method: string, params: never, options: never) => {
    sentMethods.push(method);
    return send(method as never, params, options);
  }) as typeof connector.send;
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await page.dispose();
  await browser?.close();
});

const OPTIONS = { timeout: 20000 };
const evaluate = <T>(fn: string, sandbox?: string) =>
  callFunction<T>(connector, page.contextId, fn, [], sandbox === undefined ? {} : { sandbox });

test("an init script runs before page scripts of the next document", OPTIONS, async () => {
  const handle = await page.addInitScript(() => {
    (globalThis as any).__x = 1;
  });
  await page.navigateTo(
    "data:text/html,<script>window.seenByPage = window.__x</script>",
    "complete",
  );
  assert.equal(await evaluate("() => window.seenByPage"), 1);
  await handle.dispose();
});

test("an init script registered after load applies to the current document and the next one", OPTIONS, async () => {
  await page.navigateTo("about:blank", "complete");
  const handle = await page.addInitScript(() => {
    (globalThis as any).__late = "yes";
  });
  assert.equal(await evaluate("() => window.__late"), "yes"); // current document, via the immediate run
  await page.navigateTo("about:blank?again", "complete");
  assert.equal(await evaluate("() => window.__late"), "yes"); // next document, via the registration
  await handle.dispose();
});

test("an init script receives its argument", OPTIONS, async () => {
  const handle = await page.addInitScript(
    (flags: { beta: boolean; name: string }) => {
      (globalThis as any).__flags = flags;
    },
    { beta: true, name: `q"uote 'x' \\` },
  );
  await page.navigateTo("about:blank?args", "complete");
  assert.deepEqual(await evaluate("() => window.__flags"), { beta: true, name: `q"uote 'x' \\` });
  await handle.dispose();
});

test("a string init script runs as statements", OPTIONS, async () => {
  const handle = await page.addInitScript(`window.__a = 1; window.__b = window.__a + 1;`);
  await page.navigateTo("about:blank?string", "complete");
  assert.equal(await evaluate("() => window.__b"), 2);
  await handle.dispose();
});

test("dispose stops the effect on the next navigation", OPTIONS, async () => {
  const handle = await page.addInitScript(() => {
    (globalThis as any).__gone = true;
  });
  await page.navigateTo("about:blank?with", "complete");
  assert.equal(await evaluate("() => window.__gone"), true);
  await handle.dispose();
  await page.navigateTo("about:blank?without", "complete");
  assert.equal(await evaluate("() => window.__gone"), undefined);
});

test("an init script also applies to iframes", OPTIONS, async () => {
  const handle = await page.addInitScript(() => {
    (globalThis as any).__inFrame = "yes";
  });
  await page.navigateTo("about:blank?frames", "complete");
  const seen = await callFunction<Promise<unknown>>(
    connector,
    page.contextId,
    `async () => {
      const frame = document.body.appendChild(document.createElement("iframe"));
      frame.src = "about:blank";
      await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
      return frame.contentWindow.__inFrame;
    }`,
  );
  assert.equal(seen, "yes");
  await handle.dispose();
});

test("a throwing init script does not break registration or the page", OPTIONS, async () => {
  const handle = await page.addInitScript(`throw new Error("init script boom");`);
  await page.navigateTo("about:blank?boom", "complete");
  assert.equal(await evaluate("() => 1 + 1"), 2);
  await handle.dispose();
});

test("the helper realm is registered once and invisible to the page", OPTIONS, async () => {
  await page.navigateTo("about:blank?helpers", "complete");
  await setContent(page, `<button id="b">Go</button>`);
  const button = page.locator("button[@id='b']");
  assert.equal(await button.isEnabled(), true);

  // not on the page's own window ...
  assert.equal(await evaluate("() => typeof window.__samurai"), "undefined");
  // ... only in the sandbox realm
  assert.equal(await evaluate("() => typeof globalThis.__samurai", HELPER_SANDBOX), "object");

  const registrations = () =>
    sentMethods.filter((method) => method === "script.addPreloadScript").length;
  const before = registrations();
  // more probes, after navigations: the registration is reused, and the helpers are there in each new document
  for (const url of ["about:blank?one", "about:blank?two"]) {
    await page.navigateTo(url, "complete");
    await setContent(page, `<button id="b">Go</button>`);
    assert.equal(await page.locator("button[@id='b']").isEnabled(), true);
  }
  assert.equal(registrations(), before);
});

test("page scripts cannot tamper with the helpers", OPTIONS, async () => {
  await page.navigateTo("about:blank?tamper", "complete");
  await setContent(page, `<button id="b">Go</button>`);
  await evaluate("() => { window.__samurai = { probeElement: () => 'hacked' }; }");
  const state = await page.locator("button[@id='b']").isEnabled();
  assert.equal(state, true);
});
