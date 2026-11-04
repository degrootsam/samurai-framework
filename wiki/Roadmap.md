<!-- markdownlint-disable MD041 -->

This page is the overview of what is built and what is open.

## Built

- **Protocol layer.** WebDriver BiDi connection with typed commands, refcounted event subscriptions, script calls and preload scripts.
- **Page API.** Navigation with real load waits, history, viewport, screenshots (also named, saved with the run), `waitForTimeout`, PDF, emulation, dialogs, downloads and file pickers, init scripts, console and page-error capture, user contexts and cookies.
- **Network.** Request tracking, real network-idle, waiting for requests and responses, mocking, blocking and modifying, response bodies, cache control.
- **Locators and assertions.** Role, label, text, placeholder, alt text, title, test id, CSS and XPath locators with chaining and fallbacks; auto-waiting actions; retrying `expect`.
- **Locator toolkit (0.21.3).** `nth`, `first`, `last`, `filter` (`hasText`, `hasNotText`, `has`, `hasNot`), `and` and `or`; `locator()` reads CSS as well as XPath; `getByRole` with `name` (string or `RegExp`), `exact`, `level` and the state options; `exact` and `RegExp` on the text locators; `check`, `uncheck`, `setChecked` and `selectOption`; `isHidden`, `isDisabled`, `accessibleName` and `accessibleDescription`; `toHaveAccessibleName` and `toHaveAccessibleDescription`; strict selectors (`use.strictSelectors`, `page.setStrictSelectors`, `locator.strict`). See [Locators](Locators) and [Assertions](Assertions).
- **Test API.** `describe`, `test` with `page`, `browser`, `browserName`, `env` and `secrets` fixtures; environments with variables, timeouts and base URLs; secrets from env vars or `.env.<environment>` with masking in logs and reports.
- **Recorder foundations.** Step codec (parse a spec into steps, minimal-diff edits) and a recording engine (clicks, typing, Alt+click assertions, locator ranking, record from step N).
- **Recorder toolbar.** A rail inside the recorded page: pause and resume, assertions with a choice of matcher, inserting and adding variables and secrets, waits, named screenshots and stop. Adds the `waitForTimeout` and `screenshot` steps and the `/project` writers (see [Steps and the recorder](Steps-and-the-recorder#the-toolbar)).
- **Flows.** `samurai flow list|check|run`: graphs of tests, groups, conditions, variables, waits and parallel branches, checked before they run, with a report per run. Wait, Set variable and HTTP request run, and you can write more steps, and a project can list its own steps in `samurai.config.ts` (see [Flows](Flows) and [Writing a step](Writing-a-step)).
- **Packaging.** Published on npm as `@itmetsam/samurai-framework`, with subpath exports (see [Embedding](Embedding-the-framework)) and the `samurai` command (see [Command line](Command-line)).
- **Browser management.** `samurai browsers install|list|uninstall` downloads pinned Firefox and Chrome for Testing builds into a per-user cache.
- **Test modifiers.** `test.skip`, `test.fixme` and `test.only`, also on `describe`, and `test.skip(condition, reason)` from inside a test (the condition may be a function of the fixtures); skipped tests are reported with the status `skipped`, and `forbidOnly` (on by default on CI) refuses a committed `.only` (see [Writing tests](Writing-tests#skipping-focusing-and-fixing-later)).
- **Test info and aliases.** `test.describe`, `test.beforeEach`, `test.afterEach`, `test.beforeAll` and `test.afterAll` next to the named exports; `testInfo` / `test.info()` with attachments and annotations; the `context` and `baseURL` fixtures (see [Test info](Writing-tests#test-info)).
- **Hooks.** `beforeEach` and `afterEach` around every test (in the test's browser, with its page), `beforeAll` and `afterAll` once per worker and scope; a failing hook fails its test with the hook's name (see [Hooks](Writing-tests#hooks)).
- **Retries.** `retries` in the config, `--retries` and `SAMURAI_RETRIES`: a failing test is run again with a fresh browser, up to that many times. A test that passes on a retry is one result marked `flaky`, with the errors of the failed attempts in `previousAttempts`, and does not fail the run; `test-start` is emitted per attempt and `test-end` once (see [Retries](Writing-tests#retries)).
- **Parallel runs.** `workers` in the config (default half the CPUs), `--workers` and `SAMURAI_WORKERS`: tests run at the same time in worker processes, each with its own browser, port and profile, and a flow's Parallel node runs its branches concurrently on the same pool (see [Parallel runs](Running-tests-and-reports#parallel-runs)).
- **Several browsers.** `browsers: ["firefox", "chrome"]` in the config and on each group, `--browser` on the command line: every test runs once per browser, with a result, events and a screenshot folder per browser.
- **Chrome.** Runs, records and replays on Chrome 155 through its chromedriver (BiDi over the `webSocketUrl` capability); the browser tests run on both browsers (`SAMURAI_TEST_BROWSER`). See [Chrome support](Pages-and-browsers#chrome).
- **App-facing API (0.16.0).** What the Electron app used to work out itself, the framework now states: a `capabilities` entry point with feature flags, test ids from `listTests`, whole-test ranges, a `remove-test` edit and a list of unreadable tests in the codec, `loadConfig` with every default resolved, and the recorder's first status; in 0.17.0 also the config as written next to the resolved one, and `outputDir` for a folder per run (see [Embedding](Embedding-the-framework#capabilities-and-the-resolved-config)).
- **Test inputs and outputs (0.21.0).** A test declares text `inputs` (with defaults) and `outputs`, saved with `outputs.save` or `{ output }` on `fill` and the text checks; the codec and the toolbar (Save as output, Insert → input) read and write them, and a flow passes earlier tests' outputs to later tests' inputs, checked before it runs (see [Inputs and outputs](Writing-tests#inputs-and-outputs) and [Flows](Flows#inputs-and-outputs)).
- **Flows per browser (0.21.0).** A flow runs once per browser, each run with its own variables, results and outputs; `runFlowInProject({ browsers })` picks the browsers (see [Flows](Flows#browsers)).
- **More matchers.** Locator: `toBeFocused`, `toHaveJSProperty`, `toBeInViewport`, `toBeAttached`, `toBeDisabled`, `toBeEditable`, `toHaveId`, `toBeEmpty`, `toHaveAttribute(name)`, the `enabled`, `checked` (also `"mixed"`), `visible`, `editable` and `attached` options, and `toHaveText` and `toContainText` with whitespace collapsing and arrays. Values: `toMatchObject`, `toContainEqual`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toHaveLength`, `toBeCloseTo`, `toBeInstanceOf`, `toThrow` and the asymmetric matchers. `expect.poll` and `expect(fn).toPass`. See [Assertions](Assertions).
- **Evaluate and reads.** `page.evaluate`, `locator.evaluate` and `locator.evaluateAll` (a function, a function's source or an expression string, one argument, the page's own error message); locator reads `innerText`, `innerHTML`, `allTextContents`, `allInnerTexts` and `boundingBox`; `page.waitForURL`, `page.content` and `page.setContent`; `page.setViewportSize` and a synchronous `page.viewportSize()`. See [Pages and browsers](Pages-and-browsers#running-code-in-the-page) and [Locators](Locators#running-code-on-the-element).
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

- **Mid-test abort is untested.** Aborting before a run starts and between tests is covered; aborting while a browser is running relies on the existing launch/close handling.
- **Command extras.** No `--config` flag, no watch mode; `samurai record --at` doesn't replay the steps before it.

## Open: runner and CLI

Gaps in the runner today, found while writing these docs:

- **Report formats.** Only `result/report.json` and the console output; no HTML or JUnit report.
- **Tags.** Tests can be selected by file and by name, but not by tag.
- **Failure artefacts.** No automatic screenshot, video or trace when a test fails.
- **Config loading.** `samurai.config.ts` is read from the working directory only; no `--config` flag.

## Open: framework API

- **Browsers.** Firefox and Chrome launch. Safari and Edge do not.
- **Locators.** The test-id attribute is fixed to `data-testid`. No iframe or shadow-DOM piercing beyond the browser's own support; the page-side role search and accessible names do not pierce shadow DOM either.
- **Actions.** No `hover`, `dblclick`, `type`, page-level keyboard or mouse, drag and drop, or scrolling helpers. `locator.press` presses one key on an element. `fill` replaces the whole value; there is no append.
- **Assertions.** No screenshot comparison (`toHaveScreenshot`).
- **Windows and tabs.** No `popup` event or API for tabs and windows the page opens itself; open extra pages with `context.newPage()`.
- **HTTP authentication.** `network.continueWithAuth` (basic-auth challenges) was left out of the interception work.
- **Not planned.** `webExtension.*` commands and `session.end` as public API, and WebKit (Safari has no WebDriver BiDi).

## Open: closing the gap with Playwright

What the framework still lacks next to Playwright, grouped; the order here is not a priority order.

- **Page and locator reads.** `evaluateHandle`, and a public export of `ScriptError`, `ElementHandle` and `RemoteObject`, which `evaluate` raises and returns.
- **More matchers.** `toHaveScreenshot`, `expect(promise).rejects`, `expect.not.*`, the `useInnerText` option of the text matchers.
- **Test API.** `test.use`, `test.extend`, `test.step`, a `projects` matrix, and the `isMobile` / `hasTouch` fixtures.
- **Waiting and input.** A fake clock, keyboard and mouse as page-level APIs.
- **Network.** `page.request`.
- **Runner and config.** `webServer`, `globalSetup`, serial mode and sharding, `projects`, and more reporters (see also the runner list above).
