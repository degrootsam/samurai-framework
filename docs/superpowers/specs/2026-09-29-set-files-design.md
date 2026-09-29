# `input.setFiles` — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 4
Depends on: script-call-function, locate-nodes

## Goal

Real file upload for `<input type="file">`, which pointer/keyboard input cannot do.

```ts
await page.locator("input[@type='file']").setInputFiles("./fixtures/avatar.png");
await page.locator("input[@type='file']").setInputFiles(["a.csv", "b.csv"]);
await page.locator("input[@type='file']").setInputFiles([]);   // clear
```

## Non-goals

- In-memory files (`{ name, mimeType, buffer }`); BiDi takes paths on the browser's machine only.
- Drag-and-drop uploads.
- The file chooser popup flow (downloads-and-file-dialogs spec).

## API

```ts
setInputFiles(files: string | string[], options?: { timeout?: number }): Promise<void>;
```

## Behaviour

1. Normalise `files` to an array; resolve each with `path.resolve` (relative to `process.cwd()`).
2. Before touching the browser, `fs.stat` every path: missing or a directory throws `Error("setInputFiles(): file not found: <path>")` (a local-runner assumption: browser and tests share a filesystem, true for the spawned Firefox; documented).
3. Wait (auto-wait mechanism, `waitUntil`) for checks: **attached** and **enabled**. Not *visible*: file inputs are commonly hidden behind a styled label, so visibility and hit-testing are skipped.
4. One `callFunction` reads `{ tag, type, multiple }`. Not `input[type=file]` → `ActionTimeoutError`-free immediate `Error("setInputFiles(): <selector> is not an <input type=file> (found <tag type=…>)")`. More than one file and `!multiple` → `Error("… does not accept multiple files")`.
5. `input.setFiles { context, element: SharedReference, files }`. The browser fires `input` and `change` events itself; no synthetic dispatch.
6. `[]` clears the selection and fires the events (browser behaviour; asserted in the browser test).

## Errors

| Situation | Error |
|---|---|
| Path missing | plain `Error`, before any BiDi call |
| Wrong element / multiple | plain `Error` |
| Never attached/enabled within timeout | `ActionTimeoutError` (`action: "setInputFiles"`, standard checks line) |
| Browser rejects (`no such element`, `invalid argument`) | `BiDiError` |

`ActionTimeoutError.action` union gains `"setInputFiles"`; `expect.timeout` config docs mention it.

## Testing

- Unit (stub connector): step order (stat → wait → type check → `setFiles`), `element` is the resolved `SharedReference`, absolute paths sent, multiple-files guard, wrong-element message, timeout error text, `[]` sends an empty list.
- Browser: fixture page with a file input and a listener writing `input.files[0].name` and event counts into the DOM; single upload, multiple upload, clear, hidden input behind a label, `multiple`-less input with two files errors.
- TDD: tests first.

## Implementation notes

- A directory gets its own message, `setInputFiles(): not a file: <path>` (the draft used "file not found" for both); a missing path is `setInputFiles(): file not found: <path>`. Both are checked for every path, in order, before any BiDi command is sent.
- Sequence: stat → wait (`attached`, `enabled`; no scroll, no hit test) → resolve the element again → one script reads `{ tag, type, multiple }` → `input.setFiles`. If the element vanished between the wait and the second search, the error is `Failed to locate element … no element matches`.
- `ActionTimeoutError.action` is a plain string, so `"setInputFiles"` needed no type change. The `expect.timeout` doc comment in `types/config.d.ts` was left alone.
- Verified in Firefox: the browser fires `input` and `change` exactly once per call, `[]` clears the selection, hidden inputs work, the content is readable by the page.
- Tests: `locator/set-files.test.ts`, `locator/set-files.browser-test.ts` (port 9236). The stub connector gained `input.setFiles` and `failCommand(method, error)`.
