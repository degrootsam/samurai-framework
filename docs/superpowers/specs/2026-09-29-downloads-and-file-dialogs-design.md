# Downloads and file dialogs — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 14
Depends on: bidi-foundation, set-files (file chooser reuses `setFiles`)

## Goal

Test downloads and native file pickers.

```ts
const download = await page.waitForDownload({ trigger: () => link.click() });
console.log(download.suggestedFilename(), download.url());
const file = await download.path();          // resolves once the download completed
await download.cancel?.();                   // only if the browser supports it (see below)

const chooser = await page.waitForFileChooser({ trigger: () => button.click() });
await chooser.setFiles("./fixtures/a.png");
```

## Non-goals

- Streaming download contents, resuming, progress events beyond start/end.
- Downloads from other tabs.
- Saving to arbitrary user-chosen folders per download (folder is per context/browser).

## Downloads

### Events and command

- `browsingContext.downloadWillBegin { context, navigation, url, suggestedFilename, timestamp }` and `browsingContext.downloadEnd { …, status: "complete" | "canceled", filepath? }`.
- `browser.setDownloadBehavior { downloadBehavior: { type: "allowed", destinationFolder } | { type: "denied" } | null, userContexts? }` sets where files land. The framework sets `allowed` with a per-test temp folder (`<config downloadsDir, default result/downloads>/<testId>/`) on page creation so downloads are deterministic and cleaned by the runner with the other artifacts. `null` restores the browser default.
- Browser support gate: `setDownloadBehavior` is newer than the events. If Firefox lacks it (`unknown command`), `page.waitForDownload` still works using the events, `download.path()` returns the `filepath` from `downloadEnd`, and the folder option throws `UnsupportedOperationError`. Confirmed by a browser test before the destination-folder feature ships.

### `src/browser/download.ts` (new)

```ts
class Download {
  url(): string;
  suggestedFilename(): string;
  path(): Promise<string>;              // resolves on downloadEnd complete; rejects on canceled
  failure(): Promise<string | null>;    // "canceled" or null
}
page.waitForDownload(options: { trigger?: () => Promise<unknown>; timeout?: number }): Promise<Download>;
page.on("download", (d: Download) => …);
```

- Correlation: `downloadEnd` matched to `downloadWillBegin` by `navigation` id.
- `waitForDownload` registers its `waitForEvent` **before** running `trigger`, then resolves on `downloadWillBegin` (not on end). `timeout` defaults to the navigation timeout (30000).
- `path()` has its own timeout (same default). A canceled download rejects with `DownloadError { url, reason: "canceled" }`.
- Subscription (refcounted) to both events from `Page` creation so `page.on("download")` and early downloads are not missed; events filtered by `ContextTree`.

## File dialogs

- `input.fileDialogOpened { context, element?, multiple }` fires when a click would open the native picker. Subscribed from page creation. Firefox may open the OS dialog unless it is suppressed; the browser test verifies that headless Firefox does not hang (the dialog is not shown headless).
- `page.waitForFileChooser({ trigger?, timeout? }): Promise<FileChooser>`.

```ts
class FileChooser {
  isMultiple(): boolean;
  element(): Locator | null;               // Locator pinned to the element (locate-nodes `handle` selector) when `element` was provided
  setFiles(files: string | string[]): Promise<void>;  // input.setFiles on that element; reuses set-files validation
}
```

- If `element` is absent in the event (browser omitted it), `setFiles` throws `Error("file chooser has no element reference")`.
- Unhandled dialogs are not answered; a picker that is opened while nobody waits is ignored (the headless browser closes it).

## Errors

| Situation | Error |
|---|---|
| No download within timeout | `WaitTimeoutError` → `waitForDownload(): no download started within <t>ms` |
| Download canceled | `DownloadError` from `path()` |
| `setDownloadBehavior` unsupported | `UnsupportedOperationError` (events still work) |
| Chooser without element | `Error` as above |

## Testing

- Unit (stub connector): behaviour set on page creation with per-test folder; `waitForDownload` registers before `trigger`; begin/end correlation by navigation id; canceled → rejection; `path()` timeout; iframe event accepted, foreign ignored; `FileChooser` mapping to `setFiles` with the event's element and `multiple` guard; missing element error.
- Browser (local server with `Content-Disposition: attachment`): download completes and file content matches; `suggestedFilename`; canceled/failed download (server aborts) rejects; `<input type=file>` click yields a chooser and `setFiles` populates `input.files`; behaviour of unsupported `setDownloadBehavior` recorded by an explicit skip-with-reason.
- TDD: tests first.

## Implementation notes

- **Where:** `browser/download.ts` (`Download`, `DownloadTracker`, `DownloadError`, `DownloadTimeoutError`), `browser/file-chooser.ts` (`FileChooser`, `FileChooserTracker`), `browser/downloads-dir.ts` (`prepareDownloadsDir`, `removeIfEmpty`), `browser/file-paths.ts` (`resolveFiles`, `assertIsFile`, shared with `Locator.setInputFiles`), `browser/page-wait.ts` (`DownloadWaitTimeoutError`, `FileChooserTimeoutError`), and on `Page`: `startDownloadTracking`, `startFileChooserTracking`, `waitForDownload`, `waitForFileChooser`, `page.on/once/off("download" | "filechooser")`. `Browser.downloadsDir`, config `downloadsDir` (default `result/downloads`).
- **Everything in the draft works on Firefox 153, including `browser.setDownloadBehavior`** (probed, then browser-tested), so no fallback was needed. The framework calls it when the browser starts (`allowed`, into a new folder `<downloadsDir>/dl-<time>-<pid>-<n>` of the browser's own), so a test knows where downloads land and runs do not mix. A browser without the command gets no folder (`browser.downloadsDir` is undefined, a `warn` is logged) and the events still work. `Browser.close()` removes the folder again when nothing was downloaded into it, so runs do not pile up empty folders; a folder with downloads is left for the test artifacts.
- **`Download`:** `url()`, `suggestedFilename()`, `path({ timeout? })` (waits for the end, resolves with the file the browser wrote, rejects with `DownloadError` when cancelled and `DownloadTimeoutError` after `timeout`, default the navigation timeout), `failure()` (null when complete, otherwise "canceled" or "page closed"). Ends are matched to beginnings by navigation id; an end nobody began is ignored; disposing the page fails downloads still going on with "page closed".
- **`waitForDownload({ trigger, timeout })`** resolves when the download *starts*; it listens before `trigger` runs, and a trigger that throws rejects the wait with that error. The generic `Page.waitForPageEvent` now serves the request, response, download and file-chooser waits.
- **Firefox 153 facts:** `downloadEnd`'s field is `filepath` (the local typing said `filePath`; fixed); a download the server breaks off, or one refused with `downloadBehavior: denied`, ends as `canceled`; when a name is taken Firefox saves under `report(1).csv` and its `suggestedFilename` already carries the suffix (`report(2).csv`); iframe downloads reach the page; `fileDialogOpened` fires for a click on the input and on its label, carries the input as a full node (`sharedId` is all that is used) and `multiple`, and nothing is shown in headless mode.
- **`FileChooser`:** `isMultiple()` and `setFiles(files)` (resolves paths, checks every file exists and is a file before sending, refuses several files for a single-file input, sends `input.setFiles` for the element in the frame that opened the dialog; an empty list clears; `file chooser has no element reference` when the browser omitted it). The draft's `element(): Locator` was left out: locators no longer have a pinned-handle form (see the locate-nodes notes) and `setFiles` is what a test needs. A picker nobody waits for is simply ignored and does not hang the page.
- **Cleanup in tests:** the browser test removes its downloads folder afterwards.
- Tests: `browser/download.test.ts` (12), `browser/file-chooser.test.ts` (11), `browser/downloads-dir.test.ts`, the "Page downloads and file choosers" block in `browser/page.test.ts`, `browser/transfers.browser-test.ts` (port 9250, 13 tests).
