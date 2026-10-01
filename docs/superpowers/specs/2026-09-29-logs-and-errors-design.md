# Logs and page errors (`log.entryAdded`) — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 8
Depends on: bidi-foundation, script-call-function

## Goal

Capture browser console output and uncaught page exceptions, attach them to failing tests, and optionally fail tests on page errors.

```ts
page.on("console", (msg) => console.log(msg.type(), msg.text()));
page.on("pageerror", (err) => console.log(err.message));
```

```ts
// samurai.config.ts
logs: { capture: "failures", failOnPageError: true }
```

## Non-goals

- `script.message` channels and `page.exposeFunction`.
- Console line-level source mapping.
- Browser-level (non-page) log entries.

## Components

### `src/browser/page-logs.ts` (new)

```ts
class PageLogs {
  static async start(connector, tree: ContextTree, contextId: string, options?: { maxEntries?: number }): Promise<PageLogs>;
  readonly entries: readonly LogEntry[];      // ring buffer, default 1000
  readonly errors: readonly PageError[];      // uncaught exceptions only
  on/off("console" | "pageerror", …);
  clear(): void;
  dispose(): Promise<void>;
}
```

- Subscribes (refcounted) to `log.entryAdded`; keeps entries where `source.context` is set and within the page (`ContextTree`). Entries without a context (worker realms) are ignored in v1.
- Started at page creation so early logs are not lost.
- BiDi entry → wrapper:
  - `type: "console"`: `ConsoleMessage { type() /* method: log|info|warn|error|debug|… */, text(), args: unknown[] /* fromRemoteValue */, timestamp, location, stack }`.
  - `type: "javascript"`: `PageError extends Error { message: text, stack from stackTrace, timestamp }`; also emitted as `pageerror`.
- `level` is kept on the raw entry (`debug | info | warn | error`); `console.error` is `level: "error"` but is **not** a page error.
- Ring buffer drops oldest entries and counts `dropped` for the report.

### Runner integration (`src/runner/*`)

- Config:
  ```ts
  logs?: {
    capture?: "off" | "failures" | "all";   // default "failures"
    failOnPageError?: boolean;               // default false
    ignoreErrors?: (string | RegExp)[];     // messages never counted as failures
  }
  ```
- After each test, `capture: "failures"` attaches `entries` to the `TestResult` only when the test failed; `"all"` always; `"off"` never. The reporter prints them under the failure and writes them into `result/report.json` (`logs: [{ level, type, text, timestamp }]`).
- `failOnPageError`: after the test body succeeds, if `errors` contains any not matching `ignoreErrors`, the test fails with `PageErrorsError` listing the messages. A test that already failed keeps its own error; page errors are attached as logs.
- Per-test escape hatch: `page.allowPageErrors()` (this test only).
- A fresh `Browser` per test (current runner) means no manual clearing is needed; `clear()` stays for tests that reuse a page.

## Errors

`PageErrorsError extends Error { errors: PageError[] }`, message `<n> uncaught page error(s): <first message>` plus the rest one per line.

## Testing

- Unit: entry mapping for each console method and for a javascript entry; args deserialized via `fromRemoteValue`; ring buffer overflow and `dropped`; iframe entry kept, foreign context dropped; `pageerror` emitted only for `javascript` type; `console.error` not a page error; `ignoreErrors` string and RegExp; runner attaches logs per `capture` mode and `failOnPageError` behaviour incl. `allowPageErrors`; report JSON shape.
- Browser: page calls `console.log({a:1})`, `console.error("x")`, and throws in a `setTimeout`; assert entries, args `{a:1}`, one page error with a stack.
- TDD: tests first.

## Implementation notes

- **Where:** `browser/page-logs.ts` (`PageLogs`, `ConsoleMessage`, `PageError`, `LogRecord`), `Page.startLogging/getLogs/pageErrors/clearLogs/syncLogs/allowPageErrors/pageErrorsAllowed/logsDropped` and `page.on/once/off("console" | "pageerror")`; `runner/page-logs-report.ts` (`judgePageLogs`, `PageErrorsError`); config `logs: { capture, failOnPageError, ignoreErrors }`; `logs` / `logsDropped` on test results in the report.
- **Typing fix:** the BiDi log entry text field is `text` (the local typing called it `string`).
- **Start:** `Browser.launch` / `newPage` start logging with the page, so output of the first document is kept (a browser test loads a `data:` page that logs at once). A hand-built `Page` starts on first `page.on("console" | "pageerror")` or `startLogging()`.
- **`ConsoleMessage`:** `type()` (the console method), `text()` (the browser's rendering, e.g. `hello 42 Object(2)` in Firefox), `args` (plain values through `fromRemoteValue`), `level`, `timestamp`, `location()` (top stack frame), `stackTrace`. **`PageError`** is an `Error` whose `stack` is the text plus one `at fn (url:line:col)` line per frame.
- **Buffer:** `entries` and `errors` are copies (a snapshot); the buffer keeps the newest `maxEntries` (1000) and counts `dropped`. Entries without a context (workers) and of other pages are ignored; iframes count. Entries of other types (e.g. deprecation) are recorded without an event.
- **Firefox facts:** `console.error` is `level: "error"` and not a page error; an **unhandled promise rejection is reported as a `javascript` entry**, so it is a page error and counts for `failOnPageError`.
- **`syncLogs()`** sends `session.status`: events and replies share one ordered connection, so everything logged before the call has arrived when it resolves. The runner calls it before it reads the logs.
- **Runner integration:** `judgePageLogs` is a pure function (config, entries, errors, dropped, testFailed, allowPageErrors) that returns the error to fail a passing test with, and the entries for the report; `test-runner.ts` calls it through a small `judgeLogs(page, testFailed)` helper on the three ways a test ends (passed, failed, unawaited assertions). A timed-out test ends before that and carries no logs. `capture` defaults to `"failures"`; a test that fails because of page errors counts as failed for that. `ignoreErrors` strings match as substrings.
- **Not done:** the draft said the reporter "prints" the logs under a failure; the reporter only writes `result/report.json` today, and that is where the logs go.
- Tests: `browser/page-logs.test.ts`, "Page logs" block in `browser/page.test.ts`, `runner/page-logs-report.test.ts`, `browser/page-logs.browser-test.ts` (port 9240).
