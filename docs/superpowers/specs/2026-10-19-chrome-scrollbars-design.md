# Chrome's scrollbars shrink the viewport

Date: 2026-10-19
Status: approved
Part of: [Chrome support](../chrome-support-todo.md), item 01

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `screenshot returns a PNG of the viewport, with the viewport's size`: width 385, expected 400.
- `a device pixel ratio of 2 doubles the image`: 770 wide, expected 800.
- `fullPage captures the whole document`: `width 770 (a scrollbar takes some of the 400)`.

Affects: page-api (3 tests). Later pixel-exact checks too.

## Cause

- Headless Chrome draws classic 15 px scrollbars that take part of the viewport; Firefox headless uses overlay scrollbars. A page set to 400 px has 385 px of layout width.
- Understood, not a guess: the missing 15 px is exactly the scrollbar width.

## Proposal

- Add `--hide-scrollbars` to `chromeFlags` (`src/browser/chrome-launch.ts`) for headless runs. Headed runs keep their scrollbars: a person is looking at them.
- Alternative considered: `emulation.setScrollbarTypeOverride` (overlay). It needs BiDi support in Chrome 155 and a call per context; the flag is one line and global.

## Done when

- The three tests pass on Chrome headless with no change to the tests.
- A unit test pins the flag (`chromeFlags({ headless: true })` includes it, headed does not).

## Open questions

- Is a differing layout between headed and headless acceptable for the recorder (record headed, replay headless)? Firefox already has this difference.
