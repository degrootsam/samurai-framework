# JavaScript dialogs hang or do not match Firefox

Date: 2026-10-19
Status: implemented (Task 9)
Part of: [Chrome support](../chrome-support-todo.md), item 06

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `an alert is reported and holds the page until it is accepted`: 30 s timeout. The test reads `window.__afterAlert` while the alert is open; Chrome blocks the page's main thread, so the read waits.
- `an alert nobody handles is dismissed, so a click on its button does not hang`: 30 s timeout. The log shows `userPromptOpened` with `handler: "ignore"` arriving, but the automatic dismissal does not complete.
- `a beforeunload prompt does not keep the page from navigating away`: `navigateTo(): about:blank?after failed: timeout after 10000ms`.

Affects: dialog (3 tests; the other 5 pass).

## Result (Task 9)

One cause, in the first test. On Chrome the page's main thread is blocked during `alert()`, so the test's read of `window.__afterAlert` in the dialog handler never returned, the alert stayed open, and the next two tests were stuck behind it (the unhandled-alert click and the `beforeunload` navigation both waited on that open dialog). The framework was right: in isolation, a click that opens an unhandled alert is dismissed within 1 ms on Chrome, and the dialog path needed no change.

The test now races its read against 300 ms, so it passes whether the browser answers `undefined` (Firefox) or stays blocked (Chrome). All 8 dialog tests pass on both browsers.

## Cause (original reading)

- Test 1 is a Firefox assumption: on Chrome the read can't run during `alert()`.
- Tests 2 and 3 are likely real: the unhandled-dialog path in `page.ts` (around line 1500) may rely on a Firefox event order, and Chrome shows `beforeunload` only after a user gesture.

## Proposal

- Test 1: assert the held state differently (a second `script.callFunction` with a short timeout rejects).
- Tests 2 and 3: trace the BiDi messages. Make the unhandled path call `handleUserPrompt` for every `userPromptOpened` with `handler: "ignore"` that nobody listened for, on both browsers.
- `beforeunload`: send a user-gesture activation first (a click via `input.performActions`) or accept the prompt when it opens during a navigation.

## Done when

- All 8 dialog tests pass or are skipped with a stated browser reason.
- No dialog can leave a run hanging for 30 s on Chrome.
