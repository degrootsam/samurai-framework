# JavaScript dialogs hang or do not match Firefox

Date: 2026-10-19
Status: approved
Part of: [Chrome support](../chrome-support-todo.md), item 06

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `an alert is reported and holds the page until it is accepted`: 30 s timeout. The test reads `window.__afterAlert` while the alert is open; Chrome blocks the page's main thread, so the read waits.
- `an alert nobody handles is dismissed, so a click on its button does not hang`: 30 s timeout. The log shows `userPromptOpened` with `handler: "ignore"` arriving, but the automatic dismissal does not complete.
- `a beforeunload prompt does not keep the page from navigating away`: `navigateTo(): about:blank?after failed: timeout after 10000ms`.

Affects: dialog (3 tests; the other 5 pass).

## Cause

- Test 1 is a Firefox assumption: on Chrome the read can't run during `alert()`.
- Tests 2 and 3 are likely real: the unhandled-dialog path in `page.ts` (around line 1500) may rely on a Firefox event order, and Chrome shows `beforeunload` only after a user gesture.

## Proposal

- Test 1: assert the held state differently (a second `script.callFunction` with a short timeout rejects).
- Tests 2 and 3: trace the BiDi messages. Make the unhandled path call `handleUserPrompt` for every `userPromptOpened` with `handler: "ignore"` that nobody listened for, on both browsers.
- `beforeunload`: send a user-gesture activation first (a click via `input.performActions`) or accept the prompt when it opens during a navigation.

## Done when

- All 8 dialog tests pass or are skipped with a stated browser reason.
- No dialog can leave a run hanging for 30 s on Chrome.
