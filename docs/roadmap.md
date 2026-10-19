# Roadmap: what is built and what is open

This page is the overview of what is built and what is open.

## Built

- **Protocol layer.** WebDriver BiDi connection with typed commands, refcounted event subscriptions, script calls and preload scripts.
- **Page API.** Navigation with real load waits, history, viewport, screenshots (also named, saved with the run), `waitForTimeout`, PDF, emulation, dialogs, downloads and file pickers, init scripts, console and page-error capture, user contexts and cookies.
- **Network.** Request tracking, real network-idle, waiting for requests and responses, mocking, blocking and modifying, response bodies, cache control.
- **Locators and assertions.** Role, label, text, test id, CSS and XPath locators with chaining and fallbacks; auto-waiting actions; retrying `expect`.
- **Test API.** `describe`, `test` with `page`, `browser`, `browserName`, `env` and `secrets` fixtures; environments with variables, timeouts and base URLs; secrets from env vars or `.env.<environment>` with masking in logs and reports.
- **Recorder foundations.** Step codec (parse a spec into steps, minimal-diff edits) and a recording engine (clicks, typing, Alt+click assertions, locator ranking, record from step N).
- **Recorder toolbar.** A rail inside the recorded page: pause and resume, assertions with a choice of matcher, inserting and adding variables and secrets, waits, named screenshots and stop. Adds the `waitForTimeout` and `screenshot` steps and the `/project` writers (see [Steps and the recorder](recorder.md#the-toolbar)).
- **Flows.** `samurai flow list|check|run`: graphs of tests, groups, conditions, variables, waits and parallel branches, checked before they run, with a report per run. Wait, Set variable and HTTP request run, and you can write more steps, and a project can list its own steps in `samurai.config.ts` (see [Flows](flows.md) and [Writing a step](steps.md)).
- **Packaging.** Published on npm as `@itmetsam/samurai-framework`, with subpath exports (see [Embedding](embedding.md)) and the `samurai` command (see [Command line](cli.md)).
- **Browser management.** `samurai browsers install|list|uninstall` downloads pinned Firefox and Chrome for Testing builds into a per-user cache.
- **Several browsers.** `browsers: ["firefox", "chrome"]` in the config and on each group, `--browser` on the command line: every test runs once per browser, with a result, events and a screenshot folder per browser.
- **Chrome.** Runs, records and replays on Chrome 155 through its chromedriver (BiDi over the `webSocketUrl` capability); the browser tests run on both browsers (`SAMURAI_TEST_BROWSER`). See [Chrome support](pages-and-browsers.md#chrome).
- **CI.** Typecheck, unit tests, browser tests and Trunk on every pull request (the `samurai` command's own tests, `bun run test:cli`, are run locally).

## Open: recorder

| #   | Item                                 | Notes                                                                                                                                                                                                                        |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | **Recorder UI (Electron)**           | Steps panel, step inspector, IPC to the engine, live step stream while recording. The toolbar inside the browser window is done. Lives in the separate `samurai` repository. Depends on the codec and engine, which are done |
| 7   | **Embedded recording browser**       | Recording inside the Electron editor panel through `chromium-bidi`. Chrome support (done) is its first step                                                                                                                  |
| –   | **Record more interactions**         | `<select>` choices, other key presses (arrows, shortcuts), hover, drag, dialogs, contenteditable, iframes (the toolbar is not shown in them either). Each needs a step kind in the codec first                               |
| –   | **Files manager in the app**         | Which tests use a file, and delete unused ones (in the separate `samurai` repository)                                                                                                                                        |
| –   | **Replay up to a step, then record** | Record-from-step-N numbers steps from N, but running steps 0…N−1 first is left to the caller                                                                                                                                 |
| –   | **Variables in steps**               | `${name}` references to environment variables in the steps view (specs use `env.name` today)                                                                                                                                 |

### Later, not scheduled

- AI-suggested assertions, self-healing (rewriting a stale primary locator from `locator.matchedBy`), AI agent recording. All build on the recording engine.
- `api.<name>` fixture: a per-environment HTTP client with authentication from a secret.
- Masking secrets in screenshots, videos and traces (logs and reports are already masked).

## Open: embedding

- **Engine process.** A ready-made entry point for a child process that takes `run` / `record` / `stop` / `abort` commands and answers with events over `process.send`, so the Electron app doesn't have to write it.
- **Mid-test abort is untested.** Aborting before a run starts and between tests is covered; aborting while a browser is running relies on the existing launch/close handling.
- **Logs location.** Framework logs go to `logs/` of the process's working directory, not the project folder.
- **Command extras.** No `--config` flag, no watch mode; `samurai record --at` doesn't replay the steps before it; `samurai --version` creates a `logs/` folder because the logger opens its files on import.

## Open: runner and CLI

Gaps in the runner today, found while writing these docs:

- **Report formats.** Only `result/report.json` and the console output; no HTML or JUnit report.
- **Parallel runs.** Tests run one at a time, and browsers one after the other; running several at once is missing. (`--headless`, `--port`, `--grep` and `--file` exist.) A test in one browser is the unit a scheduler can take, so parallel runs need no change to the config, the events or the report.
- **Tags.** Tests can be selected by file and by name, but not by tag.
- **Hooks and modifiers.** No `beforeEach`, `afterEach`, `beforeAll`, `afterAll`, `test.skip`, `test.only`, `test.fixme`, or retries.
- **Failure artefacts.** No automatic screenshot, video or trace when a test fails.
- **Config loading.** `samurai.config.ts` is read from the working directory only; no `--config` flag.

## Open: framework API

- **Browsers.** Firefox and Chrome launch. Safari and Edge do not.
- **Locators.** No `first()`, `last()`, `nth(i)` or `filter(...)` (use `all()`), no `getByPlaceholder` or `getByAltText`, and the test-id attribute is fixed to `data-testid`. No iframe or shadow-DOM piercing beyond the browser's own support.
- **Actions.** No `hover`, `dblclick`, `check`/`uncheck`, `selectOption`, `type`, page-level keyboard, drag and drop, or scrolling helpers. `locator.press` presses one key on an element. `fill` replaces the whole value; there is no append.
- **Assertions.** No `toBeHidden`, `toBeEnabled`, `toBeChecked`, `toHaveCSS`, `toHaveURL`, `toHaveTitle`, `toHaveClass`; no screenshot comparison. Use `expect(await page.url())` for the URL and title.
- **Windows and tabs.** No `popup` event or API for tabs and windows the page opens itself; open extra pages with `context.newPage()`.
- **HTTP authentication.** `network.continueWithAuth` (basic-auth challenges) was left out of the interception work.
- **Not planned.** `webExtension.*` commands and `session.end` as public API.
