<!-- markdownlint-disable MD041 -->

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

For element state use [`locator.waitFor`](Locators#waiting-for-state); for traffic see [Network](Network).

### Waiting for the URL

```ts
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("**/dashboard"); // a glob
await page.waitForURL(/\/orders\/\d+$/); // a RegExp, tested on the full URL
await page.waitForURL((url) => url.searchParams.get("tab") === "billing"); // a function of a URL object
await page.waitForURL("/checkout", {
  waitUntil: "domcontentloaded",
  timeout: 10_000,
});
```

`waitForURL(url, { timeout?, waitUntil? })` polls the page's URL, so it also sees a `history.pushState`, and returns at once when the URL already matches. A string equals the URL, or is a glob when it has `*` (`*` stops at `/`, `**` does not); a string starting with `/`, `./` or `../` resolves against the base URL as in `goto`. When it matches, the page waits for `waitUntil` (`"load"` by default, `"domcontentloaded"` or `"networkidle"`, as in `waitForLoadState`). `timeout` (default config `navigation.timeout`, 30 000 ms) applies to the URL and then again to the load state. A miss throws `UrlTimeoutError`, which names the pattern and the last URL. To _check_ a URL rather than wait for it, use [`expect(page).toHaveURL`](Assertions#the-page-expectpage).

## Viewport

Every page starts at 1280×720 (config `use.viewport`; `null` keeps the browser's own size), so layout and screenshots match across machines.

```ts
await page.setViewport({ width: 390, height: 844, devicePixelRatio: 3 });
await page.setViewportSize({ width: 390, height: 844 }); // Playwright's name for the same call
await page.setViewport(null); // browser's own size
console.log(page.viewportSize()); // { width: 390, height: 844 }, or null
```

`viewportSize()` is synchronous: the page remembers the last size it applied, whether through `setViewport`, `setViewportSize` or the default it gets when the browser opens it. It is `null` before a size is known, after `setViewport(null)` (the browser's own size is not read back) and when config `use.viewport` is `null`. It returns a copy and does not read the page, so a size changed by the page itself or by `emulate` is not reflected.

## Running code in the page

```ts
const title = await page.evaluate("document.title"); // an expression
const count = await page.evaluate(
  (min) => document.querySelectorAll("li").length > min,
  3,
); // a function and one argument
const data = await page.evaluate(async () => (await fetch("/api/me")).json()); // a promise is awaited
```

`evaluate(fn, arg?)` takes a function, the source of a function (`"(a) => a.x"`, `"async () => 1"`, `"function () {...}"`) or any other string, which is an expression (it takes no argument). A function is called with `arg` as its only argument. The page's own error comes through as a `ScriptError` whose message holds the page's (`Script threw: Error: boom`). For code on an element see [Running code on the element](Locators#running-code-on-the-element).

A string counts as a function when it starts with `function`, `async function`, or an arrow function head (`x =>`, `(a, b) =>`, `async () =>`). Anything else, such as `"(() => 1)()"`, is an expression.

What comes back:

| In the page                                                                                                                                      | In your test                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| string, number, boolean, `null`, `undefined`, `NaN`, `Infinity`, `-0`                                                                            | the same value                                                                              |
| array, plain object (also an instance of a class: its own properties), nested to any depth                                                       | an array or object; an `undefined` property is kept; a circular reference is rebuilt        |
| `Date`, `RegExp`, `Map`, `Set`, `BigInt`                                                                                                         | the same kind of value                                                                      |
| a DOM element                                                                                                                                    | an element reference (`ElementHandle`) you can pass as an argument to a later call          |
| a function, `window`, `Error`, `Symbol`, typed array, `ArrayBuffer`, `WeakMap`, `NodeList`, `Proxy`, generator, `URL` and other platform objects | a `RemoteObject` that only has the `type` the browser reported (`"function"`, `"error"`, …) |

Return what you need as plain data (`el.textContent`, `error.message`, `[...nodeList].map(...)`) rather than the object itself.

### Functions under tsx

`tsx` and esbuild add a `__name(...)` helper around named functions, and around an arrow function assigned to a variable. The helper does not exist in the page, so `evaluate` refuses such a function before sending it, with a `ScriptSerializationError` that says so:

```ts
await page.evaluate(() => {
  function double(n: number) {
    return n * 2;
  } // named inner function: refused under tsx
  return double(2);
});
```

Write the function without inner named functions (pass callbacks inline: `list.map((n) => n * 2)`), or pass it as a string, which is sent as written:

```ts
await page.evaluate(
  "() => { function double(n) { return n * 2; } return double(2); }",
);
```

## Page content

```ts
await page.setContent(
  "<button>Go</button><style>button { color: red }</style><script>document.title = 'x'</script>",
);
const html = await page.content(); // "<!DOCTYPE html><html>…"
await page.setContent(html2, { waitUntil: "domcontentloaded", timeout: 5000 });
```

`setContent(html, { waitUntil?, timeout? })` replaces the document in place (`document.open()`, `write()`, `close()`), so scripts and styles in `html` run and apply, and then waits for `waitUntil` (`"load"` by default). The page keeps its URL and origin; it is not a `data:` page, whose opaque origin Firefox restricts. Timing out throws `LoadStateTimeoutError`. `content()` returns the document as it is now, doctype included.

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

`name` saves the image in the result folder next to the report, and lists it in the test's report entry (see [Running tests and reports](Running-tests-and-reports#screenshots)). It combines with `path`. The name keeps letters, digits, `-` and `_`; every other character becomes `-`, and an empty name becomes `screenshot`. In one test, a repeated name gets `-2`, `-3`, …. The recorder's Screenshot tool writes this step.

## Emulation

Pretend things about the browser. `undefined` leaves an option alone, `null` restores the real value.

```ts
await page.emulate({ locale: "nl-NL", timezone: "Europe/Amsterdam" });
await page.emulate({ offline: true });
await page.grantPermission("geolocation");
await page.emulate({ geolocation: { latitude: 52.37, longitude: 4.9 } });
```

Options: `locale`, `timezone`, `userAgent`, `geolocation`, `offline`, `orientation`, `screen`, `touch`, `javaScriptEnabled`. An option the browser doesn't support throws `EmulationUnsupportedError`: Firefox 158 does not support `touch` and `javaScriptEnabled`, Chrome 155 supports every option above; if a later option fails, the earlier ones stay applied and `EmulationError` lists which. Geolocation only answers once the permission is granted. `page.emulate` wins over the context's emulation.

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

The runner puts the log in the [report](Running-tests-and-reports#page-logs) according to config `logs`.

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

// Playwright style: same waits under one name, with an optional predicate
const same = await page.waitForEvent("filechooser", {
  trigger: () => page.getByText("Upload").click(),
});
```

`waitForEvent` accepts `download`, `filechooser`, `request` and `response`.

Downloads are saved under `downloadsDir` (default `result/downloads`), in a folder per browser that is removed again when nothing was downloaded. A failed download makes `path()` throw `DownloadError`; `download.failure()` returns the reason or `null`. File pickers never show on screen; answer them with `setFiles`, which takes paths (relative ones resolve against the project folder) or `generatedFile(…)`. For a visible `<input type=file>`, `locator.setInputFiles` is simpler.

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

Launch options: `port` (remote debugging port, default 9222; Chrome picks its own and ignores it), `headless` (default `true`), `profileDir`. Pass `"chrome"` instead of `"firefox"` to launch Chrome. The browser must be installed by the framework or set on purpose; see [Which browser runs](#which-browser-runs).

## Which browser runs

The framework runs a build it downloaded itself, so every machine tests with the same browser. Launching never downloads and never uses the browser installed on the computer.

These builds are pinned by this framework version:

| Browser            | Build                            |
| ------------------ | -------------------------------- |
| Firefox            | Firefox 158.0                    |
| Chrome for Testing | Chrome for Testing 155.0.8059.79 |

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

### Chrome

Put `"chrome"` in `browsers` in `samurai.config.ts` (`browsers: ["chrome"]`, or `["firefox", "chrome"]` to run every test in both; see [Browsers](Configuration#browsers)), or pass `--browser chrome`, to run, record and replay on Chrome. Chrome has no BiDi endpoint of its own, so the framework starts the `chromedriver` that comes with the pinned Chrome (`samurai browsers install chrome` downloads both), asks it for a session with a BiDi socket, and connects to that. Everything above the connection is the same as on Firefox; the differences you can notice:

- Headless Chrome hides its scrollbars, so the viewport is the size you asked for. Headed Chrome keeps them.
- `port` is ignored: chromedriver picks the port.
- `touch` and `javaScriptEnabled` emulation work on Chrome and throw `UnsupportedOperationError` on Firefox.
- A download that finishes under a name that is taken is saved as `name(1).ext`, as on Firefox.
- `SAMURAI_CHROMEDRIVER_PATH` points a launch at another chromedriver. It must match the major version of the Chrome it starts; with `SAMURAI_CHROME_PATH` or `browserPaths.chrome` set to a different Chrome, set this too.
- A Chrome that is still running on the project's profile (`browsers/profiles/chrome`, for instance left by a killed run) stops the next launch at once with `Chrome is already running on the profile … (process <pid>)`; close it or end that process. The check reads Chrome's `SingletonLock` link, so it works on Linux and macOS; on Windows the launch still waits for the start timeout.

A run picks its browsers from `--browser`, the group being run, the config's `browsers` and then Firefox (see [Browsers](Configuration#browsers)); `Browser.launch("chrome")` and `Browser.launch("firefox")` in your own code name the browser directly. A launch picks the executable of a browser in this order:

1. `SAMURAI_FIREFOX_PATH` (or `SAMURAI_CHROME_PATH`), a path to the executable.
2. `browserPaths` in `samurai.config.ts` (see [Configuration](Configuration#browser-paths)).
3. The pinned build in the cache.

A path set in 1 or 2 must exist; otherwise the launch stops with `SAMURAI_FIREFOX_PATH points to a missing file: <path>` or `browserPaths.firefox in samurai.config.ts points to a missing file: <path>`. When there is no such path and the pinned build is not installed, you get:

```text
Firefox 158.0 is not installed. Run: samurai browsers install firefox
```

A run with no tests to run does not need a browser.

### Upgrading to 0.21.0

New: [test inputs and outputs](Writing-tests#inputs-and-outputs), wired between tests in [flows](Flows#inputs-and-outputs) (capability `testInputsOutputs`). A project that only writes and runs tests has nothing to change. Flows now run [once per browser](Flows#browsers) (capability `flowPerBrowser`, `flowsApi` 3), which changes the flow API for embedders:

- **Flow events.** Every `FlowEvent` has `browser`; `flow-start` and `flow-end` come once per browser run. A new last event, `flow-done` (`{ type, status, runs }`, no `browser`), ends the run. Key node rows by browser and node id, and wait for `flow-done`, not `flow-end`.
- **`runFlowInProject`** resolves to `FlowRunResult` (`{ status, runs: { browser, summary }[] }`) instead of a `FlowSummary`: read `runs[i].summary`.
- **Node folders.** `nodeFolder(nodeId, browser)` returns `<browser>/nodes/<id>` (was `nodeFolder(nodeId)`, `nodes/<id>`). Screenshot paths in a node's events and results are relative to `outputDir`, not to the node's folder: join `outputDir` and the path. Capabilities `nodeFolder: 2` and `flowNodeFolders: 2`.
- **The flow report** (`result/flows/<id>.json`) has `runs[]`; the top-level `nodes`, `vars` and `error` moved into `runs[].summary`. `FlowReportBuilder.finish` takes a `FlowRunResult`.
- **`runFlow`** (the walker) needs `browser` and walks once. Its `runTests` callback gets one `browser` (and `inputs`) instead of a `browsers` list. For custom handlers: `HandlerRun` has `browser`, and `run.runTests(nodeId, tests, onEvent, inputs?)` takes the inputs as its 4th argument instead of `browsers`.
- **Hand-typed node outputs are gone.** `FlowNodeModel.outputs` and `FlowNodeOutput` are removed; an old file's `outputs` is dropped on read. The node-definition flag `outputs` is removed too: stop showing an outputs editor for it.
- **Options objects.** `scopeAt(flow, nodeId, environment, { nodes, facts })` and `expressionProblems(flow, environment, { nodes, facts })`: pass `{ nodes }` where you passed `nodes`.
- **The codec.** `ParsedTest` has `titleEnd` and `options` (offsets of the title's end and the options object), plus `inputs` and `outputs`; `unparsed` has a new reason, `"dynamic-options"`. An editor that builds `ParsedTest` objects or switches on the reason must handle them.
- **Messages.** An un-awaited page assertion reads `expect(page).toHaveURL() was not awaited` (was `expect(locator)…`). The toolbar refuses a reserved input or output name with `name: "status" is reserved`, not `name: use letters, digits and _`.

Escape hatch for the longer run time: `runFlowInProject({ browsers: ["firefox"] })` runs a flow in one browser.

### Upgrading to 0.20.0

Additions; nothing to change.

- `@itmetsam/samurai-framework/flows/run` exports `nodeFolder(nodeId)`, the folder of a flow node's screenshots relative to `runFlowInProject`'s `outputDir` (see [Embedding](Embedding-the-framework)). Capability `nodeFolder`.

### Upgrading to 0.19.0

Additions; nothing to change.

- New matchers: `toBeHidden`, `toBeEnabled`, `toBeChecked`, `toHaveClass`, `toHaveCSS` on elements, and `expect(page)` with `toHaveURL` and `toHaveTitle` (see [Assertions](Assertions)). Replace `expect(await page.url())` with `await expect(page).toHaveURL(...)` to get retries.
- The codec reads and writes them; page assertions are a new step kind, `expectPage`. An editor built on the codec must render the new `Expectation` members and `expectPage` (see [the codec](Steps-and-the-recorder#the-codec)). Capabilities `assertionMatchers: 2` and `pageAssertions`.
- The recorder toolbar offers them in the Assert panel and a new Page panel (see [Page](Steps-and-the-recorder#page)).

### Upgrading to 0.18.0

- `runFlowInProject({ outputDir })` now puts each node's screenshots in `<outputDir>/nodes/<node id>/`, and their paths in the node's results are relative to that folder (in 0.17.0 they all went to `outputDir` itself). Capability `flowNodeFolders`. `runTests({ outputDir })` is unchanged.
- For code that calls `runFlow` directly: its `runTests` callback gets `nodeId`, and a handler's `run.runTests` takes the node id as its first argument.

### Upgrading to 0.17.0

Only additions; nothing to change.

- `loadConfig({ written: true })` returns the config as written next to the resolved one, and does not throw for an invalid config in that mode (see [Capabilities and the resolved config](Embedding-the-framework#capabilities-and-the-resolved-config)). Capability `writtenConfig`.
- `outputDir` on `runTests` and `runFlowInProject`: a folder per run for `report.json` and the named screenshots. Capability `outputDir`.

### Upgrading to 0.16.0

New, and nothing to change for a project that only writes and runs tests:

- `@itmetsam/samurai-framework/capabilities` and `loadConfig` from `@itmetsam/samurai-framework/project` (see [Capabilities and the resolved config](Embedding-the-framework#capabilities-and-the-resolved-config)).
- `listTests` gives each test an `id` and a `relativeFile`.
- The codec gives whole-test ranges, `removable`, the `remove-test` edit and `parseSpecFile` (see [the codec](Steps-and-the-recorder#the-codec)). **Changed:** the tests inside a `describe` whose title is built in code (or whose function isn't written in place) are no longer returned by `parseSpec`; they are reported in `parseSpecFile`'s `unparsed` instead.
- `recordSpec` calls `onStatus` once at the start, right after `onStarted`. An embedder that counted on no call at the start sees one `{ state: "recording", toolbar: true }` first.

### Upgrading to 0.15.2

`test.skip`, `test.fixme`, `describe.skip` and `describe.fixme` take an optional `{ reason }` before the body (see [Writing tests](Writing-tests#skipping-focusing-and-fixing-later)). Nothing changes for a project that does not use it. A skipped result already had an optional `reason`; it is now also set from `{ reason }`. `listTests` and `samurai list --json` get an optional `reason`, and `parseSpec` an optional `reason` on a test. `test.skip("title", { reason })` without a body now throws instead of registering a test that cannot run.

### Upgrading to 0.15.1

`parseSpec` now also returns the tests written as `test.skip(...)`, `test.fixme(...)` and `test.only(...)`, with a `modifier` field (see [the codec](Steps-and-the-recorder#the-codec)). In a file that has such tests, the index of the tests after them moves up. That index is what `applyEdit` takes as `test` and what `samurai record --test <index>` means, so an editor that stored indexes should look tests up again, or address them by name. Editing a test leaves its `test.skip(` line as it is.

### Upgrading to 0.15

`retries` is new (config, `--retries`, `SAMURAI_RETRIES`; see [Retries](Writing-tests#retries)), and it defaults to 0: a project that does not set it behaves as before, with the same results, events and report. With `retries` above 0 and a test that fails:

- A result can carry three new fields: `retry` (the attempt it is from, counting from 1), `flaky: true` (a pass after a failure) and `previousAttempts` (the errors of the earlier attempts). They are absent for a test that was not run again.
- `test-start` is emitted once **per attempt** for that test (`retry: n` from the second), and `test-end` once. Code that counts `test-start` events against `test-end` events, or takes a second `test-start` for a new test, has to key by test (`file`, `name`, `browser`).
- A test that passes on a retry is a pass, so the run `status` stays `"success"`; look at `flaky` to find such tests.
- Screenshots of an attempt after the first are in a `retry-<n>` folder inside the test's screenshot folder.

### Upgrading to 0.14

`beforeEach`, `afterEach`, `beforeAll` and `afterAll` are new (see [Hooks](Writing-tests#hooks)). A project that does not use them behaves as before: the results, events and report are the same. A spec that already defined helpers of its own with these names is unaffected, unless it imports the same names from the package. A run now waits for its workers to run their `afterAll` hooks before it ends.

### Upgrading to 0.13

Tests can be marked `test.skip`, `test.fixme` or `test.only` (see [Writing tests](Writing-tests#skipping-focusing-and-fixing-later)), and that changes a few things for code that reads results:

- A finished test can now have the status `"skipped"` (with `annotation`, optional `reason`, `duration` 0), in `result/report.json` and in events. Code that switches on `status` must handle it. The run `status` stays `"success"` when no test failed, and the exit code stays 0.
- [`forbidOnly`](Configuration#forbidonly) is on by default when `CI` is set, so a committed `.only` stops a CI run (exit code 2) instead of quietly shrinking it. Set `forbidOnly: false` to allow it.
- `samurai list --json` has a `modifier` field on tests that have one.
- The step codec reads tests inside `describe.skip`, `describe.fixme` and `describe.only`. Up to 0.15.0 it did not read the calls `test.skip(...)`, `test.fixme(...)` and `test.only(...)`; from 0.15.1 it does (see above).

### Upgrading to 0.12

Tests now run at the same time: the default for [`workers`](Configuration#workers) is half the CPUs, where 0.11 ran one test at a time. A suite whose tests share an account, a cart or other data may start to fail; set `workers: 1` in `samurai.config.ts`, pass `--workers 1`, or set `SAMURAI_WORKERS=1` to get the old behaviour back, and give the tests their own data from there (the `workerIndex` fixture tells each test which worker it runs in). A group can keep just its own tests apart with `workers: 1`. `TestResult` has a new `worker` field, and the `run-start` event a `workers` field when the run uses more than one. A run that gets its config as an object (`runTests({ config })`, `runFlowInProject({ config })`) cannot be sent to a worker and stays on one worker; embedding apps should pass `workers: 1` explicitly if they relied on one test at a time. A flow's Parallel node now really runs its branches at the same time, with its own copy of the variables in each branch (see [Flows](Flows#parallel)).

### Upgrading to 0.11

Embedding apps: `LAUNCHABLE` and `BrowserStatus.launchable` (from `@itmetsam/samurai-framework/browsers`) are gone. They were always true for both managed browsers; both can be launched, so the list of managed browsers (`MANAGED_BROWSERS`) is the list you can launch. `page.captureScreenshot()` (a method that did nothing) was removed in 0.10.x; use `page.screenshot()`. Messages thrown by `Page`, `Locator` and the other public classes now read `name(): what is wrong`; code that matches on message text should match the new text.

### Upgrading to 0.10

0.10 runs tests in one or more browsers. In `samurai.config.ts`, replace `browser: "x"` with `browsers: ["x"]`; the old key is an error (`"browser" was replaced by "browsers": use browsers: ["x"]`), not ignored. Groups can have their own `browsers`. Named screenshots now live in a folder per browser, `result/screenshots/<browser>/…`, also for a run with one browser, so the `path` in a report changes. Every result in `result/report.json` and every `test-start` / `test-end` event gains `browser`, the summary gains `browsers`, and `run-start` gains `browsers` (its `total` counts tests in every browser). The Electron app (a separate repository) has to write `browsers` in the projects it creates and read `browser` from results and events.

### Upgrading to 0.7

0.7 adds the [recorder toolbar](Steps-and-the-recorder#the-toolbar), the `waitForTimeout` and `screenshot` steps, `page.waitForTimeout` and `page.screenshot({ name })`. Specs written by 0.6 still parse; 0.6 reads the new steps as custom code. Nothing needs to change in a project.

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
