# Recorder toolbar: picks, keys and state

Date: 2026-10-19
Status: approved
Part of: [Chrome support](../chrome-support-todo.md), item 14

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `pause records nothing; resuming on another page asks and writes the goto`: state is `recording`, expected `paused`.
- `the Assert pick is prefilled with the element's text and Count offers the list items`: `Timed out waiting for the list item's pick reply`.
- `a navigation while picking leaves no step and no picker on the new page`: `Timed out waiting for the new page's expect`.
- `keys typed into the toolbar's New secret value never reach the page's listeners…`: `Timed out waiting for the secret in .env.dev`.
- `Enter and Escape that the page dispatches on the toolbar do nothing; a real Enter still adds`: `Timed out waiting for the fill from a real Enter`.

Affects: recorder-toolbar (5 tests; 9 pass).

## Cause

- Four of five time out waiting for a message that follows a pointer or key action; the fifth fails an assertion because a click on Pause did not register. Probably one cause with spec 12 (the channel) or with how `input.performActions` clicks and keys reach a closed shadow root on Chrome (focus and event retargeting differ).

## Proposal

- After 12, bisect per test: does the button get the click, is the message sent, is it received.

## Done when

- All five tests pass on Chrome.
- Recording a login flow headed on Chrome and replaying it on Firefox and Chrome works.

## Open questions

- Decided: recording on Chrome is in scope for this milestone (the recorder toolbar already works on Firefox). Specs 12–14 are part of it. Roadmap item 7 (recording inside the Electron panel) stays separate.
