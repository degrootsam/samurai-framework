# Pages and browsers

Everything here is on `page` (the fixture), `browser` or a browser context. Calls on a page that was closed throw `page closed`.

## Navigation

```ts
await page.goto("/products"); // relative: needs a baseURL
await page.navigateTo("example.com"); // no scheme: https:// is added
await page.navigateTo("localhost:3000", {
  protocol: "http",
  wait: "interactive",
});
await page.reload();
await page.goBack(); // false when there is no history entry
await page.goForward();
console.log(await page.url(), await page.title());
```

- `goto(url, options?)` resolves URLs starting with `/`, `./` or `../` against the base URL (`page.setBaseURL(...)`, else the environment's `baseURL`). Other URLs go to `navigateTo`.
- `navigateTo(url, options?)` options:
  - `wait`: `"none"` (return at once), `"interactive"` (DOMContentLoaded) or `"complete"` (load, the default; config `navigation.waitUntil`)
  - `timeout`: ms the navigation may take (default 30 000; config `navigation.timeout`)
  - `protocol`: scheme added to a URL without one (default `"https"`)
- A failed or slow navigation throws `NavigationError`. `reload()` takes the same `wait` and `timeout`; Firefox doesn't support `ignoreCache` and throws `UnsupportedOperationError` if you ask for it.

## Waiting

```ts
await page.waitForLoadState(); // "load" (default), "domcontentloaded" or "networkidle"
await page.waitForNetworkIdle({ idleTime: 500, timeout: 10_000 });
```

`waitForNetworkIdle` waits until no request has been in flight for `idleTime` ms (default 500; config `network.idleTime`). Long-lived requests (server-sent events, long polling) keep the page busy until the timeout. It throws if config `network.track` is `false`. Call `waitForLoadState` after the action that starts a navigation; a document that is still the old one counts.

For element state use [`locator.waitFor`](locators.md#waiting-for-state); for traffic see [Network](network.md).

## Viewport

Every page starts at 1280×720 (config `use.viewport`; `null` keeps the browser's own size), so layout and screenshots match across machines.

```ts
await page.setViewport({ width: 390, height: 844, devicePixelRatio: 3 });
await page.setViewport(null); // browser's own size
```

## Screenshots and PDF

```ts
await page.screenshot({ path: "out/home.png", fullPage: true });
await page.screenshot({
  type: "jpeg",
  quality: 80,
  clip: { x: 0, y: 0, width: 400, height: 300 },
});
await page.getByTestId("chart").screenshot({ path: "out/chart.png" }); // one element
const pdf = await page.pdf({
  path: "out/page.pdf",
  format: "A4",
  printBackground: true,
});
```

Both return a `Buffer` and also write to `path` (folders are created). `quality` (0–100) only applies to JPEG. PDF options: `landscape`, `scale` (0.1–2), `pageRanges`, `margin` (cm), `printBackground`, `format`.

## Emulation

Pretend things about the browser. `undefined` leaves an option alone, `null` restores the real value.

```ts
await page.emulate({ locale: "nl-NL", timezone: "Europe/Amsterdam" });
await page.emulate({ offline: true });
await page.grantPermission("geolocation");
await page.emulate({ geolocation: { latitude: 52.37, longitude: 4.9 } });
```

Options: `locale`, `timezone`, `userAgent`, `geolocation`, `offline`, `orientation`, `screen`, `touch`, `javaScriptEnabled`. An option the browser doesn't support throws `EmulationUnsupportedError`; if a later option fails, the earlier ones stay applied and `EmulationError` lists which. Geolocation only answers once the permission is granted. `page.emulate` wins over the context's emulation.

## Console output and page errors

Logging starts when the page opens, so early output is kept.

```ts
page.on("console", (message) => console.log(message.type(), message.text()));
page.on("pageerror", (error) => console.error(error.message));
page.getLogs(); // newest entries, oldest first (buffer of 1000)
page.pageErrors(); // uncaught exceptions
page.clearLogs();
page.allowPageErrors(); // this test may have page errors even if logs.failOnPageError is on
```

The runner puts the log in the [report](running-and-reports.md#page-logs) according to config `logs`.

## Dialogs

`alert`, `confirm`, `prompt` and `beforeunload` prompts are handled for you so a test can't hang: a dialog nobody answers is dismissed (`beforeunload` is accepted). To answer one yourself, listen before the action:

```ts
page.on("dialog", async (dialog) => {
  console.log(dialog.type(), dialog.message());
  await dialog.accept("my answer"); // or dialog.dismiss()
});
await page.getByRole("button", { name: "Delete" }).click();
```

## Downloads and file pickers

```ts
const download = await page.waitForDownload({ trigger: () => link.click() });
console.log(download.suggestedFilename());
const file = await download.path(); // waits until the download finished; returns its location

const chooser = await page.waitForFileChooser({
  trigger: () => page.getByText("Upload").click(),
});
await chooser.setFiles("./fixtures/avatar.png");
```

Downloads are saved under `downloadsDir` (default `result/downloads`), in a folder per browser that is removed again when nothing was downloaded. A failed download makes `path()` throw `DownloadError`; `download.failure()` returns the reason or `null`. File pickers never show on screen; answer them with `setFiles`. For a visible `<input type=file>`, `locator.setInputFiles` is simpler.

## Init scripts

Run code in the page before any page script, in every future document and once in the current one:

```ts
await page.addInitScript(() => {
  window.__testMode = true;
});
await page.addInitScript(
  (flags) => {
    window.flags = flags;
  },
  { beta: true },
);
```

The argument must be JSON-serialisable. The function is serialised as source, so it can't use variables from the test file.

## Browsers

The runner launches the browser for you. To control it yourself (scripts, experiments), launch it directly:

```ts
import { Browser } from "./src/browser/browser.js";

const { browser, page } = await Browser.launch("firefox", {
  port: 9222,
  headless: true,
});
await page.goto("https://example.com");
await browser.close();
```

Launch options: `port` (remote debugging port, default 9222), `headless` (default `true`), `profileDir`. The browser must be installed; if it can't be found you get `Cannot find browser firefox on this machine! Is it installed?`.

## Contexts

A context is an isolated session inside one browser: its own cookies, storage and cache. Use them for two users at once or for a clean slate within a test.

```ts
test("two users", async ({ browser }) => {
  const alice = await browser.newContext({ locale: "nl-NL" });
  const bob = await browser.newContext({ acceptInsecureCerts: true });
  const alicePage = await alice.newPage();
  const bobPage = await bob.newPage();
  // …
});
```

`browser.close()` removes contexts that are still open. `newContext` accepts the emulation options above plus `acceptInsecureCerts` and `unhandledPromptBehavior`.

On a context:

```ts
await context.addCookies([
  { name: "session", value: "abc", url: "https://example.com", httpOnly: true },
]);
const cookies = await context.cookies({ name: "session" });
await context.clearCookies();
await context.emulate({ timezone: "Asia/Tokyo" }); // every page, including later ones
await context.setPermission("geolocation", "granted", "https://example.com");
context.pages();
await context.close(); // the default context can't be closed
```

`browser.contexts()` lists the default context and the open ones. `page.context()` gives a page's context.
