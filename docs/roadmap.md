# Roadmap: what is built and what is open

Detailed plans live in [`superpowers/recorder-roadmap.md`](superpowers/recorder-roadmap.md) and [`superpowers/bidi-roadmap.md`](superpowers/bidi-roadmap.md). This page is the overview.

## Built

- **Protocol layer.** WebDriver BiDi connection with typed commands, refcounted event subscriptions, script calls and preload scripts.
- **Page API.** Navigation with real load waits, history, viewport, screenshots, PDF, emulation, dialogs, downloads and file pickers, init scripts, console and page-error capture, user contexts and cookies.
- **Network.** Request tracking, real network-idle, waiting for requests and responses, mocking, blocking and modifying, response bodies, cache control.
- **Locators and assertions.** Role, label, text, test id, CSS and XPath locators with chaining and fallbacks; auto-waiting actions; retrying `expect`.
- **Test API.** `describe`, `test` with `page`, `browser`, `env` and `secrets` fixtures; environments with variables, timeouts and base URLs; secrets from env vars or `.env.<environment>` with masking in logs and reports.
- **Recorder foundations.** Step codec (parse a spec into steps, minimal-diff edits) and a recording engine (clicks, typing, Alt+click assertions, locator ranking, record from step N).
- **Flows.** `samurai flow list|check|run`: graphs of tests, groups, conditions, variables, waits and parallel branches, checked before they run, with a report per run. HTTP request, Database query, Email inbox and Script nodes can't run yet (see [Flows](flows.md)).
- **CI.** Typecheck, unit tests, browser tests and Trunk on every pull request.

## Open: recorder

| #   | Item                                 | Notes                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | **Recorder UI (Electron)**           | Steps panel, step inspector, IPC to the engine, live step stream while recording. Lives in the separate `samurai` repository. Depends on the codec and engine, which are done                                                                                                                                              |
| 6   | **Chrome support**                   | Likely through the `chromium-bidi` mapper (BiDi over CDP). The recorder UI also needs it for item 7                                                                                                                                                                                                                        |
| 7   | **Embedded recording browser**       | Render the page under test inside the editor panel (a `WebContentsView`), expose CDP, run the mapper in Electron's main process and add a framework transport for it. Needs a spike first: CDP port exposure, mapper needing browser-level CDP, user contexts and downloads in Electron. In-app recording is Chromium-only |
| –   | **Record more interactions**         | `<select>` choices, other key presses (arrows, shortcuts), hover, drag, file uploads, dialogs, contenteditable, iframes. Each needs a step kind in the codec first                                                                                                                                                         |
| –   | **Replay up to a step, then record** | Record-from-step-N numbers steps from N, but running steps 0…N−1 first is left to the caller                                                                                                                                                                                                                               |
| –   | **Variables in steps**               | `${name}` references to environment variables in the steps view (specs use `env.name` today)                                                                                                                                                                                                                               |

### Later, not scheduled

- AI-suggested assertions, self-healing (rewriting a stale primary locator from `locator.matchedBy`), AI agent recording. All build on the recording engine.
- `api.<name>` fixture: a per-environment HTTP client with authentication from a secret.
- Masking secrets in screenshots, videos and traces (logs and reports are already masked).

## Open: embedding

- **Engine process.** A ready-made entry point for a child process that takes `run` / `record` / `stop` / `abort` commands and answers with events over `process.send`, so the Electron app doesn't have to write it.
- **Mid-test abort is untested.** Aborting before a run starts and between tests is covered; aborting while a browser is running relies on the existing launch/close handling.
- **Logs location.** Framework logs go to `logs/` of the process's working directory, not the project folder.
- **Publishing.** Not on npm; consumers link the built package.
- **Command extras.** No `--config` flag, no watch mode; `samurai record --at` doesn't replay the steps before it; `samurai --version` creates a `logs/` folder because the logger opens its files on import.

## Open: runner and CLI

Gaps in the runner today, found while writing these docs:

- **Report formats.** Only `result/report.json` and the console output; no HTML or JUnit report.
- **Parallel runs.** Tests run one at a time; running several at once is missing. (`--headless`, `--port`, `--grep` and `--file` exist.)
- **Tags.** Tests can be selected by file and by name, but not by tag.
- **Hooks and modifiers.** No `beforeEach`, `afterEach`, `beforeAll`, `afterAll`, `test.skip`, `test.only`, `test.fixme`, or retries.
- **Failure artefacts.** No automatic screenshot, video or trace when a test fails.
- **Packaging.** The package builds to `dist/` with subpath exports (see [Embedding](embedding.md)) and has a `samurai` command (see [Command line](cli.md)), but isn't published to npm.
- **Config loading.** `samurai.config.ts` is read from the working directory only; no `--config` flag.

## Open: framework API

- **Browsers.** Firefox only (see Chrome above); only Firefox install locations are searched.
- **Locators.** No `first()`, `last()`, `nth(i)` or `filter(...)` (use `all()`), no `getByPlaceholder` or `getByAltText`, and the test-id attribute is fixed to `data-testid`. No iframe or shadow-DOM piercing beyond the browser's own support.
- **Actions.** No `hover`, `dblclick`, `check`/`uncheck`, `selectOption`, keyboard `press`/`type`, drag and drop, or scrolling helpers. `fill` replaces the whole value; there is no append.
- **Assertions.** No `toBeHidden`, `toBeEnabled`, `toBeChecked`, `toHaveCSS`, `toHaveURL`, `toHaveTitle`, `toHaveClass`; no screenshot comparison. Use `expect(await page.url())` for the URL and title.
- **Windows and tabs.** No `popup` event or API for tabs and windows the page opens itself; open extra pages with `context.newPage()`.
- **HTTP authentication.** `network.continueWithAuth` (basic-auth challenges) was left out of the interception work.
- **Not planned.** `webExtension.*` commands and `session.end` as public API.
