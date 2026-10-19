# Chrome support Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome runs the same tests, flows and recordings as Firefox: the browser suite passes on both browsers, or a test is skipped on one of them with a stated reason.

**Architecture:** Chrome speaks BiDi through its chromedriver (`src/browser/chrome-launch.ts`, already written): the framework spawns chromedriver, creates a session with `webSocketUrl: true` and connects to the socket it returns. Everything above the transport is shared with Firefox. The remaining work is the 15 differences found by running the browser suite on Chrome 155. Each task below is one approved spec.

**Tech Stack:** TypeScript, Node 20+, WebDriver BiDi, `node:test` + `tsx`.

**Specs:** `docs/superpowers/specs/2026-10-19-*-design.md`. Overview: `docs/superpowers/chrome-support-todo.md`.

## Global Constraints

- Branch `feat/chrome-support`, cut from `main`. Task 0 commits the launcher that already exists.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Checks before every commit: `npx tsc --noEmit -p .`, `npm test`, and the browser files a task names, on **both** browsers once Task 1 is done.
- One browser file on one browser: `SAMURAI_TEST_BROWSER=chrome npx tsx --test --test-concurrency=1 --test-timeout=60000 <file>` (before Task 1 exists: temporarily edit the launch line and revert it).
- Chrome and chromedriver 155 must be installed: `npx tsx src/index.ts browsers install chrome`.
- A Firefox result must never get worse. A fix that changes shared code is re-run on Firefox.
- **Hypotheses are not facts.** Specs 02, 03, 04, 07, 08, 09, 12, 13 and 14 name a likely cause. Their first step is a repro that confirms or replaces it; the fix follows the confirmed cause, and the spec is edited if the cause was different.
- Process-leak check after any Chrome run: `pgrep -f "[c]hromedriver-linux64|[c]hrome-linux64"` prints nothing. (Use the `[c]` form so `pgrep` does not match itself.)
- Test names that say "Firefox" are renamed when the test becomes browser-neutral.

## Order and dependencies

```text
0 groundwork -> 1 (spec 00, test matrix) -> everything else
2 (spec 01), 3 (spec 11), 4 (spec 10)         small, independent
5 (spec 02) -> 6 (spec 03)                    both screenshot code
7 (spec 04), 8 (spec 05), 9 (spec 06)         independent
10 (spec 07) -> 11 (spec 08) -> 12 (spec 09)  network and navigation waits
13 (spec 12) -> 14 (spec 13), 15 (spec 14)    recorder toolbar
16 docs and CI                                last
```

## File structure

| File                                                 | Responsibility                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/browser/chrome-launch.ts` (exists)              | chromedriver, session, flags, capabilities, the process handle            |
| `src/browser/session-capabilities.ts` (exists)       | Capabilities shared by Firefox `session.new` and the chromedriver session |
| `src/testing/test-browser.ts` (new)                  | `testBrowser()`, `onlyOn`, `skipOn`                                       |
| `src/testing/browser-fixture.ts`                     | Existing test helper; gains a `launchTestBrowser()` shortcut              |
| `src/browser/page.ts`, `page-logs.ts`, `download.ts` | Page behaviour that differs per browser                                   |
| `src/recorder/toolbar/*`                             | Toolbar injection and input (tasks 13–15)                                 |

---

## Task 0: Commit the launcher groundwork

**Files:** everything `git status` shows for the Chrome launcher (`browser.ts`, `chrome-launch*.ts`, `session-capabilities.ts`, `browsers/*`, `bidi-connection.ts`, `browser.d.ts`, `browser-finder.ts`, the three updated unit tests) and the 15 specs, the todo list and this plan.

- [ ] Create the branch: `git switch -c feat/chrome-support`.
- [ ] Run `npx tsc --noEmit -p .` and `npm test`; both pass.
- [ ] Add unit tests that are still missing: `BiDiConnector.onClosed` fires once on close and error and not on `kill()` (`src/transport/bidi-connection.test.ts`); `ChromeProcess` emits `exit` when the socket closes, and `kill()` sends `DELETE` on the session before ending chromedriver (inject a fake `spawn` and `fetch`; export the class or take them as parameters).
- [ ] Commit: `feat: launch Chrome through chromedriver`, and a second commit `docs: Chrome support specs and plan`.

---

## Task 1: Run the browser tests on either browser (spec 00)

**Files:** create `src/testing/test-browser.ts` (+ `.test.ts`); modify all 24 `*.browser-test.ts` call sites, `package.json`, `src/testing/browser-fixture.ts`.

- [ ] Write the failing unit test: `testBrowser()` returns `"firefox"` with no env, `"chrome"` for `SAMURAI_TEST_BROWSER=chrome`, and throws `Unknown SAMURAI_TEST_BROWSER "edge". Choose firefox or chrome.` for anything else.
- [ ] Implement `testBrowser()`.
- [ ] Failing test for the wrappers: `onlyOn("firefox", reason, name, fn)` and `skipOn("chrome", reason, name, fn)` register `fn` as a normal test when the browser matches and as a skipped test named `<name> (skipped on <browser>: <reason>)` otherwise. Take `test` as a parameter so the unit test can pass a fake.
- [ ] Implement them over `node:test`'s `test` / `test.skip`.
- [ ] Add `launchTestBrowser(options)` to `browser-fixture.ts`: `Browser.launch(testBrowser(), options)`. Replace every `Browser.launch("firefox"` in `*.browser-test.ts` (`grep -rl 'launch("firefox"' src`).
- [ ] Mark the tests that assert Firefox limits with the wrappers: `reload({ ignoreCache })…unsupported by this Firefox`, `touch and javaScriptEnabled…`, `newContext refuses an unsupported option…`, the `(Firefox)` page-logs test (Task 3 renames it again), `userAgent`/`screen` stay un-marked (Task 8 decides).
- [ ] `package.json`: `"test:browser": "tsx --test --test-concurrency=1 --test-timeout=60000 …"`, new `"test:browser:chrome": "SAMURAI_TEST_BROWSER=chrome npm run test:browser"` (use `cross-env`-free form for Windows if the repo needs it; check CI).
- [ ] Run `npm run test:browser` (Firefox: same results as before this task, no new failures) and `npm run test:browser:chrome` (the 36 known failures, now listed with names).
- [ ] Commit: `test: run the browser tests on Firefox or Chrome`.

## Task 2: Hide scrollbars in headless Chrome (spec 01)

**Files:** `src/browser/chrome-launch.ts`, `chrome-launch.test.ts`.

- [ ] Failing unit test: `chromeFlags({ headless: true, … })` includes `--hide-scrollbars`; headed does not.
- [ ] Add the flag inside the headless branch of `chromeFlags`.
- [ ] Run `page-api.browser-test.ts` on Chrome: `screenshot returns a PNG…`, `a device pixel ratio of 2 doubles the image`, `fullPage captures the whole document` pass.
- [ ] Commit: `fix: headless Chrome hides scrollbars so the viewport is the size asked for`.

## Task 3: Same text for unhandled rejections (spec 11)

**Files:** `src/browser/page-logs.ts`, `page-logs.test.ts`, `page-logs.browser-test.ts`.

- [ ] Failing unit test on the message normaliser: `Uncaught (in promise) Error: x` becomes `Error: x`; text without the prefix is unchanged; the prefix in the middle of a message is unchanged.
- [ ] Implement it where `PageError.message` is built (around `page-logs.ts` line 61/194), with a comment listing the prefix.
- [ ] Rename the browser test (drop "(Firefox)") and unmark it if Task 1 marked it.
- [ ] Run `page-logs.browser-test.ts` on both browsers. Commit: `fix: page errors read the same on Chrome and Firefox`.

## Task 4: Unique download names on both browsers (spec 10)

**Files:** `src/browser/download.ts`, `download.test.ts`, `transfers.browser-test.ts`.

- [ ] Repro: on Chrome, log `downloadWillBegin` and `downloadEnd` for two downloads of `report.csv`; record what path each reports and whether the first is overwritten.
- [ ] Failing unit test (fake filesystem folder): a finished download whose target exists is moved to `report (1).csv`, then `report (2).csv`; `suggestedFilename()` stays `report.csv`; contents are never mixed.
- [ ] Implement in the download tracker's end handler, for both browsers; keep Firefox's own renaming from double-renaming (check the final path the event reports before moving).
- [ ] Run `transfers.browser-test.ts` on both browsers. Commit: `fix: a second download with the same name never replaces the first`.

## Task 5: Pixel ratio reset (spec 02)

**Files:** `src/browser/page.ts` (`setViewport`, around line 599–640, and `applyDefaultViewport`), `page.test.ts`, `page-api.browser-test.ts`.

- [ ] Repro script (scratchpad): set `devicePixelRatio: 2`, reset with `setViewport(null)`-style call, read `window.devicePixelRatio` on both browsers. Write the result into the spec's Cause section.
- [ ] Failing unit test against the fake socket that matches the confirmed behaviour (for example: the reset sends the launch ratio, not `null`).
- [ ] Implement; read and store the launch ratio once per page if that is the fix.
- [ ] Run `page-api.browser-test.ts` on both browsers: `clip captures a box…` and `a locator's screenshot is the size of its element` pass in file order and alone (`--test-name-pattern`).
- [ ] Commit: `fix: resetting the viewport also resets the device pixel ratio on Chrome`.

## Task 6: Screenshot of an element below the fold (spec 03)

**Files:** `src/browser/screenshot.ts`, its unit test, `page-api.browser-test.ts`.

- [ ] Repro: log the clip sent by `locator.screenshot()` for the below-the-fold element on Chrome and Firefox. Record it in the spec.
- [ ] Failing unit test for the clip calculation with an element outside the viewport.
- [ ] Implement the single code path chosen in the spec (scroll first, or document origin).
- [ ] Add a test for an element taller than the viewport.
- [ ] Run `page-api.browser-test.ts` on both browsers. Commit: `fix: screenshots of elements outside the viewport on Chrome`.

## Task 7: History navigation (spec 04)

**Files:** `src/browser/page.ts` (`goBack`, `goForward`), `page.test.ts`, `page-api.browser-test.ts`, maybe `context-tree.ts`.

- [ ] Repro: log `browsingContext.contextCreated`, `contextDestroyed`, `historyUpdated` and `navigationCommitted` around `goBack` on Chrome. State in the spec whether the context id changes.
- [ ] Failing unit test for the confirmed behaviour (the page re-binds to the new id, or waits for the event).
- [ ] Implement. If `Page.id` can change, check every holder of the old id (`ContextTree`, trackers, locators) and add a test for one of them.
- [ ] Run `page-api.browser-test.ts` and `navigation.browser-test.ts` on both browsers. Commit: `fix: goBack and goForward keep the page on Chrome`.

## Task 8: Emulation that does nothing (spec 05)

**Files:** `src/browser/emulation.ts`, `emulation.test.ts`, `emulation.browser-test.ts`, `docs/pages-and-browsers.md`.

- [ ] Repro per option on Chrome: apply `userAgent`, `screen`, `touch`, `javaScriptEnabled`, `locale`, `timezone`, `geolocation` (whatever `EmulationOptions` has), then read the effect from the page. Fill a table (applies / ignored / error) into the spec.
- [ ] For each ignored option: throw `UnsupportedOperationError` that names Chrome, or add the cheap workaround the spec allows. Failing unit test first for each.
- [ ] Rewrite the Firefox-limit tests as pairs with the wrappers: Firefox asserts the limit, Chrome asserts the working behaviour or the error.
- [ ] Add the per-browser support table to the docs.
- [ ] Run `emulation.browser-test.ts` on both browsers. Commit: `fix: emulation options either work on Chrome or say they cannot`.

## Task 9: Dialogs (spec 06)

**Files:** `src/browser/page.ts` (unhandled path around line 1500), `dialog.ts`, `dialog.test.ts`, `dialog.browser-test.ts`.

- [ ] Repro the unhandled alert and the `beforeunload` navigation on Chrome with the BiDi trace; write down the event order next to Firefox's.
- [ ] Failing unit tests with a fake socket for the event order Chrome sends (prompt opened with `handler: "ignore"` and no listener: `handleUserPrompt` is called once).
- [ ] Implement the fix; for `beforeunload` apply the gesture or accept-on-open approach from the spec, whichever the repro supports.
- [ ] Rewrite `an alert is reported and holds the page until it is accepted` so it asserts the held state in a way that is valid on both browsers (a second script call that is still pending after 200 ms).
- [ ] Run `dialog.browser-test.ts` on both browsers. Commit: `fix: dialogs on Chrome are answered and never hang a run`.

## Task 10: waitForLoadState and the hung page (spec 07)

**Files:** `src/browser/page.ts` (`waitForLoadState`), `chrome-launch.ts`, `navigation.browser-test.ts`.

- [ ] Rerun `navigation.browser-test.ts` on Chrome with `--test-timeout=60000` and keep the assertion text of both failing tests in the spec.
- [ ] Repro the hang with only the never-answering page; confirm whether chromedriver closes the socket (`WebSocket closed` in the log) and when.
- [ ] Try `pageLoadStrategy: "none"` in `chromeCapabilities`. Keep it only if the repro or one of the two tests changes with it; if kept, add a comment saying what it prevents. Update `chrome-launch.test.ts`.
- [ ] Failing unit test: a pending `waitForLoadState` rejects with `ConnectionClosedError` when the socket closes.
- [ ] Run the file on both browsers; it finishes in under 60 s on Chrome. Commit: `fix: load waits end on Chrome when the page never answers`.

## Task 11: Request interception (spec 08)

**Files:** `src/network/router.ts`, `network-tracker.ts` and their tests, `router.browser-test.ts`.

- [ ] Repro the four tests with a BiDi trace: how many `beforeRequestSent`, `responseStarted`, `fetchError` events per request id; what `continueRequest` with a body does to `Content-Length`.
- [ ] Failing unit tests with duplicated events: one request counts once in flight; one handler error reports once.
- [ ] Implement counting by request id; de-duplicate the failure report.
- [ ] Failing unit test: `continue({ body })` sets `Content-Length` to the byte length of the new body (and removes `Transfer-Encoding` if present). Implement.
- [ ] Run `router.browser-test.ts` on both browsers. Commit: `fix: request interception counts and rewrites requests correctly on Chrome`.

## Task 12: Network idle and body collection (spec 09)

**Files:** `src/network/network-tracker.ts`, `data-collector.ts`, tests, `network-tracker.browser-test.ts`, `network-data.browser-test.ts`.

- [ ] Capture the assertion output of both tests on Chrome (write it into the spec).
- [ ] Per cause found: fix in the framework (release of a request the server dropped; the unavailable-reason text) with a failing unit test first, or make the test browser-aware with a reason.
- [ ] Run both files on both browsers. Commit: `fix: dropped requests and oversized bodies behave the same on Chrome`.

## Task 13: Toolbar on every document (spec 12)

**Files:** `src/recorder/toolbar/*`, `toolbar.browser-test.ts`.

- [ ] Repro: navigate twice with the toolbar installed; log preload script ids, `script.realmCreated` and the channel messages on Chrome. Record the finding in the spec.
- [ ] Failing unit test for the confirmed cause (for example: the channel subscription is renewed per realm).
- [ ] Implement. Keep the toolbar absent from iframes.
- [ ] Run `toolbar.browser-test.ts` on both browsers. Commit: `fix: the recorder toolbar returns on every document on Chrome`.

## Task 14: Toolbar drag (spec 13)

**Files:** the toolbar's drag code, `toolbar.browser-test.ts`.

- [ ] Repro: log the pointer positions the page receives for the test's `performActions` on both browsers; compare `origin`, `clientY`, `pageY`, `screenY`.
- [ ] Failing test for the conversion at the confirmed cause; implement it.
- [ ] Run `toolbar.browser-test.ts` on both browsers. Commit: `fix: dragging the toolbar lands where the pointer is on Chrome`.

## Task 15: Recorder toolbar input (spec 14)

**Files:** `src/recorder/toolbar/*`, `recorder-toolbar.browser-test.ts`.

- [ ] After Task 13: run the file on Chrome and keep the five failures. For each, find whether the click or key reaches the button (add a console trace in the page), whether the toolbar sends the message and whether the recorder receives it.
- [ ] Failing test or unit test per cause; fix.
- [ ] End-to-end check, written into the plan's checklist when done: `samurai record` on Chrome headed — record a login flow with an Alt+click assertion, a file pick and a named screenshot; replay the spec on Chrome and on Firefox.
- [ ] Run `recorder-toolbar.browser-test.ts`, `recorder.browser-test.ts` and `session.browser-test.ts` on both browsers. Commit: `fix: the recorder toolbar takes clicks and keys on Chrome`.

## Task 16: Docs, config and CI

**Files:** `docs/pages-and-browsers.md`, `configuration.md`, `roadmap.md`, `cli.md`, `docs/superpowers/specs/2026-10-15-browser-management-design.md`, `src/types/config.d.ts`, `.github/workflows/*`, `CHANGELOG`/version.

- [ ] Docs: Chrome row says launchable; which options differ (from Task 8); `SAMURAI_CHROMEDRIVER_PATH`; `launchOptions.port` ignored for Chrome; `browser: "chrome"` in config.
- [ ] `config.d.ts`: remove "Only firefox can launch today".
- [ ] Roadmap: item 6 moves to Built; the "Browsers" line under framework API is removed; item 7 notes it no longer waits on item 6.
- [ ] Verify the launch on macOS and Windows (Linux only so far); note anything that differs.
- [ ] Run `ensureWarm("chrome")` twice; the `.samurai-launched` stamp appears once and the second call skips.
- [ ] CI: add a Chrome job that installs Chrome and runs `npm run test:browser:chrome`; cache key includes the chromedriver build.
- [ ] Bump the version (minor) and `npm run build`.
- [ ] Commit: `docs: Chrome support`; open the PR from `feat/chrome-support`.

## Review Focus

1. Task 1: a Firefox run before and after must list the same passing tests; the wrappers only skip tests that were already Firefox-only.
2. Task 4: two downloads of the same name in two contexts at the same time never pick the same free name.
3. Task 5/8: Firefox pixel ratio and emulation results unchanged.
4. Task 9/10: a dialog or a hung page can never leave a Chrome or chromedriver process running (run the leak check).
5. Task 13–15: the toolbar's closed shadow root and its page isolation hold on Chrome (page scripts can't read or dispatch to it).
