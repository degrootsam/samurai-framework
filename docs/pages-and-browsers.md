# Pages and browsers

Everything here is on `page` (the fixture), `browser` or a browser context. `page.close()` closes the tab; calls on a page that was closed throw `page closed`.

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

```ts
await page.waitForTimeout(2000); // wait 2 s
```

`waitForTimeout(ms)` waits a fixed time and throws a `RangeError` for a negative or non-finite value. Prefer waiting for something (an assertion, `waitForNetworkIdle`) when you can.

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
await page.screenshot({ name: "after-sign-in", fullPage: true }); // saved with the run
const pdf = await page.pdf({
  path: "out/page.pdf",
  format: "A4",
  printBackground: true,
});
```

Both return a `Buffer` and also write to `path` (folders are created). `quality` (0–100) only applies to JPEG. PDF options: `landscape`, `scale` (0.1–2), `pageRanges`, `margin` (cm), `printBackground`, `format`.

`name` saves the image in the result folder next to the report, and lists it in the test's report entry (see [Running tests and reports](running-and-reports.md#screenshots)). It combines with `path`. The name keeps letters, digits, `-` and `_`; every other character becomes `-`, and an empty name becomes `screenshot`. In one test, a repeated name gets `-2`, `-3`, …. The recorder's Screenshot tool writes this step.

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
page.on("console", (message) => console.log(message.type(), message.text())); // also page.once and page.off
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

Launch options: `port` (remote debugging port, default 9222), `headless` (default `true`), `profileDir`. The browser must be installed by the framework or set on purpose; see [Which browser runs](#which-browser-runs).

## Which browser runs

The framework runs a build it downloaded itself, so every machine tests with the same browser. Launching never downloads and never uses the browser installed on the computer.

These builds are pinned by this framework version:

| Browser            | Build                            | Launchable |
| ------------------ | -------------------------------- | ---------- |
| Firefox            | Firefox 158.0                    | yes        |
| Chrome for Testing | Chrome for Testing 155.0.8059.79 | not yet    |

Download them once per machine:

```sh
samurai browsers install firefox   # or chrome, or all (the default)
samurai browsers                   # what is installed
```

Builds go in a per-user cache folder, shared by all projects:

| OS      | Folder                                                               |
| ------- | -------------------------------------------------------------------- |
| macOS   | `~/Library/Caches/samurai/browsers`                                  |
| Linux   | `$XDG_CACHE_HOME/samurai/browsers`, else `~/.cache/samurai/browsers` |
| Windows | `%LOCALAPPDATA%\samurai\browsers`                                    |

`SAMURAI_BROWSERS_PATH` replaces the folder. A download goes into a temporary `.staging-…` folder inside it and moves into place once complete, so a download that was interrupted leaves nothing behind that counts, and two installs at once (the app and the CLI, two CI jobs) do not break each other. Staging folders a killed download left behind are removed after a day.

`SAMURAI_BROWSERS_BASE_URL` is for tests only: it points the downloads at another server, and nothing checks what that server sends. `samurai browsers install` prints `Downloading from <url>` when it is set.

The first start of a freshly downloaded build can be slow (macOS checks the new app). `samurai run` and `samurai record` therefore start a new build once, headless, before the first test or recording, and remember that in the build folder. If the browser still takes more than two minutes to start, the launch stops with `Firefox 158.0 did not finish starting within 120s. The first start after an install can be slow; run again.`

A launch picks the browser in this order:

1. `SAMURAI_FIREFOX_PATH` (or `SAMURAI_CHROME_PATH`), a path to the executable.
2. `browserPaths` in `samurai.config.ts` (see [Configuration](configuration.md#browser-paths)).
3. The pinned build in the cache.

A path set in 1 or 2 must exist; otherwise the launch stops with `SAMURAI_FIREFOX_PATH points to a missing file: <path>` or `browserPaths.firefox in samurai.config.ts points to a missing file: <path>`. When there is no such path and the pinned build is not installed, you get:

```text
Firefox 158.0 is not installed. Run: samurai browsers install firefox
```

A run with no tests to run does not need a browser.

### Upgrading to 0.7

0.7 adds the [recorder toolbar](recorder.md#the-toolbar), the `waitForTimeout` and `screenshot` steps, `page.waitForTimeout` and `page.screenshot({ name })`. Specs written by 0.6 still parse; 0.6 reads the new steps as custom code. Nothing needs to change in a project.

### Upgrading to 0.6

Before 0.6 the framework used the Firefox installed on the computer. Now it does not. Run `samurai browsers install firefox` once per machine, or set `SAMURAI_FIREFOX_PATH` to the Firefox you want to keep using. The project's Firefox profile keeps working even when a newer system Firefox opened it before: the framework lets Firefox open a profile from a newer version.

On CI, run `samurai browsers install firefox` before `samurai run`, and cache the cache folder between runs, keyed on the lockfile, because a new framework version can pin new browsers. `~/.cache/samurai/browsers` below is the Linux folder; on macOS runners use `~/Library/Caches/samurai/browsers`, on Windows `%LOCALAPPDATA%\samurai\browsers` (or set `SAMURAI_BROWSERS_PATH` to one folder everywhere):

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/samurai/browsers
    key: browsers-${{ runner.os }}-${{ hashFiles('**/package-lock.json', '**/bun.lock') }}
- run: npx samurai browsers install firefox
```

The download contains Firefox only, not the system libraries it needs. GitHub's Ubuntu runners have them; on a minimal Linux image (a slim Docker image, for example) install them first, e.g. `apt-get install -y libgtk-3-0 libasound2 libx11-xcb1 libdbus-glib-1-2`.

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
