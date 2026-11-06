<!-- markdownlint-disable MD041 -->

This page is the overview of what is built and what is open.

## Built

- **Protocol layer.** WebDriver BiDi connection with typed commands, refcounted event subscriptions, script calls and preload scripts.
- **Page API.** Navigation with real load waits, history, viewport, screenshots (also named, saved with the run), `waitForTimeout`, PDF, `page.use()` settings, dialogs, downloads and file pickers, init scripts, console and page-error capture, user contexts and cookies.
- **API requests.** `page.request`, `context.request`, the `request` fixture and `request.newContext()`: get, post, put, patch, delete, head and fetch with params, data, form, multipart, redirects and a cookie bridge to the browser context (see [API requests](API-requests)). Not done: requests in the page's network events and the report, an HTTP proxy.
- **Web server and global hooks.** `webServer` (one or several servers, ready by url or port, reuse, process-group shutdown, base URL fallback) and `globalSetup` / `globalTeardown` around the run (see [Configuration](Configuration#web-server)).
- **Serial mode, `fullyParallel` and sharding.** `test.describe.serial` / `describe.configure({ mode })` (ordered on one worker, the rest skipped after a failure, the whole block run again with retries), the `fullyParallel` option and `--shard=current/total` (see [Serial mode](Writing-tests#serial-mode), [Sharding](Running-tests-and-reports#sharding)). Not done: merging the reports of several shards.
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
- **Steps, expected failures and timeouts.** `test.step` with nesting and a report field, `test.fail` (also `test.fail("title", fn)` and in a `describe`), `test.slow`, and `test.setTimeout` / `testInfo.setTimeout` that re-arm the limit from the start of the test (see [Steps, expected failures and timeouts](Writing-tests#steps-expected-failures-and-timeouts)).
- **Keyboard, mouse and more input.** `page.keyboard` (`press` with chords, `down`, `up`, `type`, `insertText`), `page.mouse` (`move`, `down`, `up`, `click`, `dblclick`, `wheel`), and on locators `hover`, `dblclick`, `tap`, `dragTo`, `dispatchEvent`, `blur`, `clear`, `pressSequentially`, `click` with `button`, `clickCount`, `modifiers`, `position` and `delay`, and `press` with chords (see [Locators](Locators#actions) and [Keyboard and mouse](Pages-and-browsers#keyboard-and-mouse)).
- **Custom fixtures.** `test.extend` with fixtures that depend on each other and on the built-in ones, set up lazily, `auto` fixtures, overriding built-ins and chaining; metadata for a catalog (`label`, `icon`, `description`, `outputs`, `timeout`), option fixtures (`<name>Options`, set with `use`), `config.fixtures` and `listFixtures()`, `use.fixtures` to attach or remove fixtures per config, environment, group and test (an environment can turn one off), `scope: "worker"`, and a `fixtures` list in every test result (see [Your own fixtures](Writing-tests#your-own-fixtures)). Not done: fixtures that an editor makes without code (`*.fixture.json`), a `log` function for fixtures.
- **Use options.** `use` in the config and `test.use({...})` per file or `describe`: `locale`, `timezone`, `userAgent`, `geolocation`, `offline`, `orientation`, `screen`, `javaScriptEnabled`, `acceptInsecureCerts`, `hasTouch`, `isMobile`, `storageState`, `extraHTTPHeaders` and `colorScheme`, applied to the test's page and to every context it opens, plus the `isMobile` and `hasTouch` fixtures. One vocabulary: `page.use({...})` and `context.use({...})` take the run-time options at run time (they replace the earlier `page.emulate` and `context.emulate`; `timezoneId` and `touch` became `timezone` and `hasTouch`). `isMobile` and `hasTouch` are Chrome only (ignored with a one-time warning on Firefox). See [Use options](Writing-tests#use-options).
- **Hooks.** `beforeEach` and `afterEach` around every test (in the test's browser, with its page), `beforeAll` and `afterAll` once per worker and scope; a failing hook fails its test with the hook's name (see [Hooks](Writing-tests#hooks)).
- **Retries.** `retries` in the config, `--retries` and `SAMURAI_RETRIES`: a failing test is run again with a fresh browser, up to that many times. A test that passes on a retry is one result marked `flaky`, with the errors of the failed attempts in `previousAttempts`, and does not fail the run; `test-start` is emitted per attempt and `test-end` once (see [Retries](Writing-tests#retries)).
- **Parallel runs.** `workers` in the config (default half the CPUs), `--workers` and `SAMURAI_WORKERS`: tests run at the same time in worker processes, each with its own browser, port and profile, and a flow's Parallel node runs its branches concurrently on the same pool (see [Parallel runs](Running-tests-and-reports#parallel-runs)).
- **Groups as projects.** `groups[].use` (the config's `use` options and `viewport`, over the config's and under `test.use()`), a repeatable `--group` that runs a test once per selected group, an optional `group` on every result and test event, and `testInfo.project.name` equal to the group (see [Group use](Configuration#group-use) and [Porting from Playwright](Porting-from-Playwright)).
- **Several browsers.** `browsers: ["firefox", "chrome"]` in the config and on each group, `--browser` on the command line: every test runs once per browser, with a result, events and a screenshot folder per browser.
- **Chrome.** Runs, records and replays on Chrome 155 through its chromedriver (BiDi over the `webSocketUrl` capability); the browser tests run on both browsers (`SAMURAI_TEST_BROWSER`). See [Chrome support](Pages-and-browsers#chrome).
- **App-facing API (0.16.0).** What the Electron app used to work out itself, the framework now states: a `capabilities` entry point with feature flags, test ids from `listTests`, whole-test ranges, a `remove-test` edit and a list of unreadable tests in the codec, `loadConfig` with every default resolved, and the recorder's first status; in 0.17.0 also the config as written next to the resolved one, and `outputDir` for a folder per run (see [Embedding](Embedding-the-framework#capabilities-and-the-resolved-config)).
- **More typed steps (0.22.2).** The codec types `check`, `uncheck`, `selectOption`, `hover`, `dblclick` and `clear`, nine more matchers (`toBeFocused`, `toBeDisabled`, `toBeEditable`, `toBeAttached`, `toBeInViewport`, `toBeEmpty`, `toHaveId`, `toHaveAccessibleName`, `toHaveAccessibleDescription`) and the newer locator forms (`exact`, regex text and name, `getByPlaceholder` / `getByAltText` / `getByTitle`, the `getByRole` state options, `nth`, `first`, `last`, `filter({ hasText })`); the recorder writes `check` / `uncheck` for a checkbox or radio click and `selectOption` for a select choice (see [Steps](Steps-and-the-recorder#steps)).
- **Test inputs and outputs (0.21.0).** A test declares text `inputs` (with defaults) and `outputs`, saved with `outputs.save` or `{ output }` on `fill` and the text checks; the codec and the toolbar (Save as output, Insert → input) read and write them, and a flow passes earlier tests' outputs to later tests' inputs, checked before it runs (see [Inputs and outputs](Writing-tests#inputs-and-outputs) and [Flows](Flows#inputs-and-outputs)).
- **Flows per browser (0.21.0).** A flow runs once per browser, each run with its own variables, results and outputs; `runFlowInProject({ browsers })` picks the browsers (see [Flows](Flows#browsers)).
- **More matchers.** Locator: `toBeFocused`, `toHaveJSProperty`, `toBeInViewport`, `toBeAttached`, `toBeDisabled`, `toBeEditable`, `toHaveId`, `toBeEmpty`, `toHaveAttribute(name)`, the `enabled`, `checked` (also `"mixed"`), `visible`, `editable` and `attached` options, and `toHaveText` and `toContainText` with whitespace collapsing and arrays. Values: `toMatchObject`, `toContainEqual`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toHaveLength`, `toBeCloseTo`, `toBeInstanceOf`, `toThrow` and the asymmetric matchers. `expect.poll` and `expect(fn).toPass`. See [Assertions](Assertions).
- **Evaluate and reads.** `page.evaluate`, `locator.evaluate` and `locator.evaluateAll` (a function, a function's source or an expression string, one argument, the page's own error message); locator reads `innerText`, `innerHTML`, `allTextContents`, `allInnerTexts` and `boundingBox`; `page.waitForURL`, `page.content` and `page.setContent`; `page.setViewportSize` and a synchronous `page.viewportSize()`. See [Pages and browsers](Pages-and-browsers#running-code-in-the-page) and [Locators](Locators#running-code-on-the-element).
- **CI.** Typecheck, unit tests, browser tests and Trunk on every pull request (the `samurai` command's own tests, `bun run test:cli`, are run locally).

## Open: recorder

| #   | Item                                 | Notes                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | **Recorder UI (Electron)**           | Steps panel, step inspector, IPC to the engine, live step stream while recording. The toolbar inside the browser window is done. Lives in the separate `samurai` repository. Depends on the codec and engine, which are done                                               |
| 7   | **Embedded recording browser**       | Recording inside the Electron editor panel through `chromium-bidi`. Chrome support (done) is its first step                                                                                                                                                                |
| –   | **Record more interactions**         | multiple selects, other key presses (arrows, shortcuts), hover and double clicks (the codec has the steps; the recorder does not guess them), drag, dialogs, contenteditable, iframes (the toolbar is not shown in them either). Each needs a step kind in the codec first |
| –   | **Files manager in the app**         | Which tests use a file, and delete unused ones (in the separate `samurai` repository)                                                                                                                                                                                      |
| –   | **Replay up to a step, then record** | Record-from-step-N numbers steps from N, but running steps 0…N−1 first is left to the caller                                                                                                                                                                               |
| –   | **Variables in steps**               | `${name}` references to environment variables in the steps view (specs use `env.name` today)                                                                                                                                                                               |

### Later, not scheduled

- AI-suggested assertions and self-healing (rewriting a stale primary locator from `locator.matchedBy`). Both build on the recording engine.
- `api.<name>` fixture: a per-environment HTTP client with authentication from a secret.
- Masking secrets in screenshots, videos and traces (logs and reports are already masked).

## Built: AI agent

The `@itmetsam/samurai-framework/agent` entry and `samurai generate` (see [AI agent](AI-agent)): the page snapshot with references and secret masking, the tools that write typed steps through the recorder's path, the loop on the AI SDK with step, token and time limits, a session (pause, take over, stop, answer), project instructions (`AGENTS.md`, `.samurai/agent.md`), the model set-up per provider and `AGENT-GUIDE.md` for other coding agents. The planning agent (`samurai plan`, `runPlan`, `generate --plan`): a read-only exploration that writes a Markdown plan, which `generate` then follows (see [Planning a test](AI-agent#planning-a-test)). Continue mode (`continueAt`): replays the first steps of an existing test, then the agent writes new ones at that index (see [Continuing a test](AI-agent#continuing-a-test)). Not done in planning: blocking a `GET` that changes data, several plans at once. Not done: running the finished test once and repairing what fails, API-test generation, multi-tab and iframe flows, file steps, organisation-wide provider policy.

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
- **Actions.** No scrolling helpers (`scrollIntoViewIfNeeded`) and no multi-touch gestures. `fill` replaces the whole value; to append, use `pressSequentially`. Firefox drops HTML5 drags with synthetic events (see [Drag and drop](Locators#drag-and-drop)).
- **Assertions.** No screenshot comparison (`toHaveScreenshot`).
- **Windows and tabs.** No `popup` event or API for tabs and windows the page opens itself; open extra pages with `context.newPage()`.
- **HTTP authentication.** `network.continueWithAuth` (basic-auth challenges) was left out of the interception work.
- **Not planned.** `webExtension.*` commands and `session.end` as public API, and WebKit (Safari has no WebDriver BiDi).

## Open: closing the gap with Playwright

What the framework still lacks next to Playwright, grouped; the order here is not a priority order.

- **Page and locator reads.** `evaluateHandle`, and a public export of `ScriptError`, `ElementHandle` and `RemoteObject`, which `evaluate` raises and returns.
- **More matchers.** `toHaveScreenshot`, `expect(promise).rejects`, `expect.not.*`, the `useInnerText` option of the text matchers.
- **Test API.** A way to save a `storageState` from a logged-in context.
- **Waiting and input.** A fake clock.
- **Runner and config.** More reporters (see also the runner list above). A `projects` matrix is not planned: a group with its own `use` and `browsers` does the job (see [Porting from Playwright](Porting-from-Playwright)).
