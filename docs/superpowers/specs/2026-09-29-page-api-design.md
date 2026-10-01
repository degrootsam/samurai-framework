# Page API completeness — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 11
Depends on: bidi-foundation, script-call-function

## Goal

Finish the everyday page surface with BiDi commands that have no framework wrapper yet, and fix `captureScreenshot`, which currently throws its result away (`// TODO: Store screenshot`).

```ts
await page.setViewport({ width: 1280, height: 720, devicePixelRatio: 2 });
await page.reload({ wait: "complete", ignoreCache: true });
await page.goBack(); await page.goForward();
const png = await page.screenshot({ path: "out/home.png", fullPage: true });
await page.locator("//header").screenshot();
await page.pdf({ path: "out/page.pdf", format: "A4" });
page.url(); await page.title();
await page.close({ runBeforeUnload: true });
```

## Non-goals

- Window management (`browser.setClientWindowState`).
- PDF header/footer templates (not in BiDi).
- Multi-page tab APIs (contexts spec).

## API and mapping

| Method | BiDi | Notes |
|---|---|---|
| `setViewport({ width, height, devicePixelRatio? })` | `browsingContext.setViewport { context, viewport, devicePixelRatio }` | `null` resets. Validates positive integers. |
| `reload({ wait?, ignoreCache? })` | `browsingContext.reload` | same wait/timeout/`NavigationError` semantics as `navigateTo` (navigation-waits spec) |
| `goBack()` / `goForward()` | `browsingContext.traverseHistory { delta: ∓1 }` | resolves `true`; on `no such history entry` resolves `false` (not an error, matches Playwright's null) |
| `screenshot(options?)` | `browsingContext.captureScreenshot` | returns `Buffer`; see below |
| `Locator.screenshot(options?)` | `captureScreenshot` with `clip: { type: "element", element: SharedReference }` | scrolls into view first (`attached`+`visible` wait) |
| `pdf(options?)` | `browsingContext.print` | returns `Buffer`; `path`, `landscape`, `scale`, `pageRanges`, `margin`, `background`, `format` (`A4`/`Letter` → page size in cm) |
| `url()` | `callFunction(() => location.href)` | |
| `title()` | `callFunction(() => document.title)` | |
| `close({ runBeforeUnload? })` | `browsingContext.close { promptUnload }` | further use of the page throws `Error("page closed")`; disposes trackers/subscriptions |

### Screenshot

```ts
interface ScreenshotOptions {
  path?: string;                       // written (dirs created) in addition to being returned
  fullPage?: boolean;                  // origin: "document"; default "viewport"
  clip?: { x: number; y: number; width: number; height: number };
  type?: "png" | "jpeg";               // format.type
  quality?: number;                    // 0–100 → format.quality 0–1, jpeg only
}
```

- Base64 result decoded to a `Buffer`.
- Default output dir for auto-named screenshots (test failure screenshots, next step of the runner) from config `screenshotDir` (default `result/screenshots`); this spec only provides the mechanism.
- `clip` and `fullPage` combine as BiDi `clip: { type: "box", x, y, width, height }` with `origin: "document"`.

### Default viewport

`use: { viewport: { width: 1280, height: 720 } }` in config applied when a `Page` is created, so headless screenshots are reproducible. `viewport: null` keeps the browser default.

## Errors

| Situation | Error |
|---|---|
| Invalid viewport numbers | `RangeError` before sending |
| `jpeg` quality out of range or with png | `RangeError` |
| Locator not attached/visible within timeout | `ActionTimeoutError` (`action: "screenshot"`) |
| Use after `close()` | `Error("page closed")` |
| Screenshot/print rejected (`unable to capture screen`) | `BiDiError` |

## Testing

- Unit (stub connector): payload for each method; base64 → Buffer and `path` write (temp dir); clip/fullPage/jpeg mapping; `goBack` false on `no such history entry`; viewport validation; `close` sets closed state and disposes trackers; default viewport applied at creation; `Locator.screenshot` uses element clip with the resolved reference.
- Browser: viewport 400×300 reflected by `innerWidth`; PNG magic bytes; full-page taller than viewport; element screenshot dimensions ≈ bounding box; history back/forward across two `about:blank`-style data pages; PDF starts with `%PDF`.
- TDD: tests first.

## Implementation notes

- **Where:** `browser/screenshot.ts` (`takeScreenshot`, `writeOutput`), `browser/pdf.ts` (`printPdf`, paper sizes), and on `Page`: `setViewport`, `applyDefaultViewport`, `reload`, `goBack`, `goForward`, `url`, `title`, `screenshot`, `pdf`, `close`, `closed`; `Locator.screenshot`. Config `use.viewport` (default 1280x720; `null` keeps the browser's own size).
- **Image types go out as MIME types** (`image/png`, `image/jpeg`): Firefox silently answers a PNG for anything else (`"jpeg"` included). `quality` (0–100, jpeg only) is sent as a 0–1 fraction; the local `ImageFormat` typing was narrowed to five literal qualities and is now a `number`. `captureScreenshot`'s result type is `{ data: string }` (was `{}`).
- **`screenshot`:** nothing but the context is sent by default; `fullPage` adds `origin: "document"`, `clip` a box (viewport coordinates, or document coordinates together with `fullPage`), `path` writes the file after creating folders. A quality without `type: "jpeg"`, or outside 0–100, is a `RangeError` before anything is sent. `Locator.screenshot` waits for attached + visible (with a scroll into view) and clips to the element (`ActionTimeoutError` with `action: "screenshot"`).
- **The old `Page.captureScreenshot(clip, format, origin)` is left as it was;** `screenshot()` is the API to use. The auto-named failure screenshot and a `screenshotDir` config were not added ("this spec only provides the mechanism").
- **`reload`** shares `navigateTo`'s handling (default wait `complete` or config, `NavigationError` named `reload(): <url> failed: …`, the navigation timeout, progress tracking for `wait: "none"`; the code moved into a private `Page.navigation()`). **Firefox 153 does not support `ignoreCache`** (`unsupported operation`), so asking for it throws `UnsupportedOperationError`.
- **`goBack` / `goForward`** answer false on `no such history entry`. A new tab's initial `about:blank` is not a history entry. Walking a tab back past its first entry lands on Firefox's own start page, and a later `reload` there hung until the navigation timeout in one run; keep tests inside the entries they created.
- **`setViewport`** validates positive integers (`RangeError`); `null` resets size and ratio. An omitted `devicePixelRatio` keeps the current one (BiDi's behaviour), so reset with `null` when a test set one. Firefox headless opens at 1227x682, hence the 1280x720 default, applied by `Browser.launch` / `newPage`.
- **`pdf`:** `landscape`, `scale` (0.1–2, `RangeError`), `pageRanges`, `margin` (centimetres), `printBackground`, `format` (A0–A6, Letter, Legal, Tabloid, Ledger; unknown is a `RangeError`) and `path`. Browser test: A4 is about 595x842 pt, landscape swaps them, Letter is about 612x792 (found by inflating the PDF's compressed streams).
- **`close({ runBeforeUnload })`** sends `browsingContext.close` (`promptUnload`), treats `no such frame` as already closed, then disposes what the page registered (errors from that are only logged). After it `page.closed` is true and `navigateTo`, `reload`, `goBack`, `goForward`, `screenshot`, `pdf`, `url`, `title`, `setViewport`, `waitForLoadState`, `addInitScript`, `route`, `locator` and the `getBy*` methods throw `page closed`; a second `close()` does nothing. Closing the browser's last tab may end the browser.
- Tests: the "Page API" block in `browser/page.test.ts`, `browser/page-api.browser-test.ts` (port 9244; PNG dimensions read from the header, JPEG quality vs size, PDF page boxes, history, reload, close).
