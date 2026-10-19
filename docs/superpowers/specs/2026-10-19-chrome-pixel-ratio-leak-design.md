# A device pixel ratio set once stays on the page

Date: 2026-10-19
Status: approved
Part of: [Chrome support](../chrome-support-todo.md), item 02

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `clip captures a box…`: 100×120, expected 50×60.
- `a locator's screenshot is the size of its element`: 240×160, expected 120×80.
- Both are exactly 2× the right size, and both run after `a device pixel ratio of 2 doubles the image` on the same page.

Affects: page-api (2 tests); anything that sets the ratio on a shared page.

## Update after spec 01

With `--hide-scrollbars` (spec 01) both symptoms are gone: `clip captures a box…` and `a locator's screenshot is the size of its element` now pass on Chrome, in file order. The doubled sizes came with the scrollbar change, so the "ratio stays at 2" reading above may be wrong.

One new observation: `setViewport changes the size and the pixel ratio, null puts the browser's size back` failed once in three runs (`[500, 320]` still read after `setViewport(null)`), and passed alone and in the two other runs. That looks like a race between the reset and the next read. Task 5 starts by reproducing that, and closes this spec if there is nothing left.

## Cause

- Hypothesis, not yet verified: `browsingContext.setViewport({ devicePixelRatio: null })` resets the ratio in Firefox but not in Chrome's mapper, so the reset leaves 2 behind.
- First step is a ten-line repro against `page.setViewport` to confirm which call leaves the ratio.

## Proposal

- If `null` does not reset: send the default ratio explicitly (the value read at launch from `window.devicePixelRatio`) when resetting.
- If the ratio resets but a capture reads a stale value: re-read it per capture.

## Done when

- Setting ratio 2 and resetting returns `window.devicePixelRatio` to the launch value on Chrome and Firefox.
- The two tests pass in file order and in isolation.
