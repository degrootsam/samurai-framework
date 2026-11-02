# Test runner and report — design

Date: 2026-10-15
Status: implemented; this note was written afterwards, from the code
Code: `src/runner/`, `src/config/run-settings.ts`, `src/browser/evidence.ts`
Guides: [Running tests and reports](../../running-and-reports.md), [Embedding the framework](../../embedding.md#running-tests-from-code)
Related: [Test API alignment](2026-10-01-test-api-alignment-design.md) (fixtures, environments, secrets), [Logs and page errors](2026-09-29-logs-and-errors-design.md), [Groups](2026-10-15-groups-design.md)

## Goal

Run a project's specs one test at a time, each in a clean browser, and leave a result that a person, a CI job and the Electron app can all read: live events while it runs, a JSON report when it ends, and an exit status.

## Non-goals

- Parallel tests, retries, `beforeEach`/`afterEach`/`beforeAll`/`afterAll`, `test.skip`/`only`/`fixme`, tags.
- HTML or JUnit reports; screenshots, video or traces captured automatically on failure.
- Running in the Electron main process (no TypeScript loader, CommonJS). An app runs the framework in a child process.

## Decisions

- **A fresh browser per test.** The runner launches the browser, opens a page, runs the test with its fixtures and closes the browser afterwards. Nothing (cookies, storage, a stuck dialog) carries over. It costs seconds per test and buys isolation.
- **One run per process.** Config, run settings, secrets and the test registry are process-wide. A second concurrent `runTests` throws; parallel runs use a child process each.
- **Specs are imported, which registers them.** `test` and `describe` push into the registry when a spec is imported. A new run imports the specs afresh, so edits are seen in a long-lived process. Specs must be ES modules: a project without `"type": "module"` is refused before any spec loads (`module-type.ts`), because a CommonJS spec gets second copies of the framework's classes and `expect(locator)` stops recognising locators.
- **Selection before launching.** Files (`files`), group, exact names (`testNames`) and `grep` are applied to the registered tests; `listTests` and `listGroups` stop there without launching anything. A run with no tests needs no browser.
- **The browser is checked once, before the first test.** `ensureWarm` resolves the browser (a missing build is one clear error, not a failure per test) and does a fresh build's slow first start outside any test's timeout.
- **A test ends exactly once.** Whatever comes first decides the result: the body resolves or throws, the test's `timeout` fires (`type: "timeout"`, `Test timed out after N seconds`), the run is aborted (`Run aborted`), or the browser goes away (`The browser was closed while the test was running`). Later signals are ignored.
- **A passing body can still fail.** After the body resolves, the runner fails the test for a matcher that was never awaited (`expect(locator).toBeVisible() was not awaited`), for an error thrown in a `page.route` handler, and, with `logs.failOnPageError`, for an uncaught page exception not matched by `logs.ignoreErrors` or allowed by `page.allowPageErrors()`.
- **Results are keyed by file and full name.** Equal titles in different files or `describe` blocks stay apart.
- **Events and the report are the same data.** `TestReporter` emits `run-start`, `test-start`, `test-end` and `run-end` to `onEvent` and builds the summary that `run-end` carries and `result/report.json` holds. A throwing listener is ignored so a UI bug can't break a run. `samurai run --json` prints these events.
- **Errors are flat on the test entry.** `type` (`error`, `assertion`, `timeout`), `message`, `stack`, and for assertions `expected` and `actual`, so tools show expected against actual without parsing messages.
- **Everything is masked on the way out.** `prepareRun` registers every secret of the environment for masking before anything runs (and warns for a value shorter than 4 characters). Results pass through `maskDeep` before they reach events or the report.
- **Page logs are kept per policy.** The page's console and uncaught exceptions are buffered (newest 1000); `logs.capture` (`failures` by default, `all`, `off`) decides which tests carry them, with `logsDropped` when the buffer overflowed.
- **Named screenshots are evidence of the test.** `page.screenshot({ name })` writes below `result/screenshots/<spec relative to srcDir, without extension>/<test name>/` and lists `{ name, path }` on the test's entry, `path` relative to `result/`.
- **Paths follow `projectDir`.** The config, `.env.<environment>`, `srcDir`, `result/` and `downloadsDir` resolve from `projectDir` (default: the working directory). Framework logs (`logs/`) follow the process's working directory.

## Components

| Module                | Role                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| `run.ts`              | Public entry: `runTests`, `listTests`, `listGroups`, the event and result types         |
| `project.ts`          | `withProject`: reads the config, prepares the run, guards against concurrent runs       |
| `prepare-run.ts`      | Environment choice, secrets loading and masking registration                            |
| `registry.ts`         | `test`, `describe` and the registered tests                                             |
| `test-runner.ts`      | Selection, the per-test lifecycle above, fixtures (`page`, `browser`, `env`, `secrets`) |
| `reporter.ts`         | `TestReporter`: events, summary, `result/report.json`                                   |
| `page-logs-report.ts` | Which logs go in the report; `PageErrorsError`, `RouteErrorsError`                      |
| `test-error.ts`       | Turning a thrown value into the flat error fields                                       |
| `module-type.ts`      | The `"type": "module"` check                                                            |
| `browser/evidence.ts` | Where named screenshots go and how names are cleaned                                    |

## Testing

- Unit tests: `registry.test.ts`, `reporter.test.ts`, `test-runner.test.ts`, `prepare-run.test.ts`, `page-logs-report.test.ts`, `test-error.test.ts`, `module-type.test.ts`, `groups.test.ts`, `run-groups.test.ts`, `run-browser-missing.test.ts`.
- Browser tests: `run.browser-test.ts` runs whole projects against Firefox: events, a project outside the working directory, selection by name and a second run in the same process, abort, a concurrent run refused, a CommonJS project refused, a browser that goes away mid-test. `screenshots.browser-test.ts` covers named screenshots.

## Open

- Parallel runs, hooks and modifiers, retries, tags.
- HTML and JUnit reports, failure artefacts.
- A ready-made engine process for the Electron app (`run` / `record` / `stop` / `abort` over `process.send`).
- Aborting while a browser is mid-test is not covered by a test of its own.
