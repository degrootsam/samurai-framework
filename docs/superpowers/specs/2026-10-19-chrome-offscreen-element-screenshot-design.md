# Screenshot of an element below the fold fails

Date: 2026-10-19
Status: implemented (Task 6)
Part of: [Chrome support](../chrome-support-todo.md), item 03

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `a locator's screenshot scrolls an element below the fold into view`: `browsingContext.captureScreenshot failed (unable to capture screen): Unable to capture screenshot with zero dimensions: width=90, height=0`.

Affects: page-api (1 test); every element screenshot of an element outside the viewport.

## Result (Task 6)

Repro: the element is in view after the scroll (rect `y: 242`, viewport 300), yet Chrome's `element` clip fails with `height=0`, so the first guess (a clip computed before the scroll) was only half right: Chrome's mapper cannot capture an `element` clip that is not wholly in the viewport at the moment it measures. Fix: `takeScreenshot` reads the element's box in document coordinates (`getBoundingClientRect` plus the scroll offset) and captures it as a `box` clip with `origin: "document"`. One code path for both browsers; an element taller than the viewport is captured whole (new browser test).

## Cause

- Hypothesis: the clip is computed in viewport coordinates before the scroll, so for an element outside the viewport its intersection with the viewport is empty (height 0). Firefox clips against the page differently.
- Verify by logging the clip sent for the test element.

## Proposal

- Scroll the element into view first, read its box, capture with `origin: "viewport"`; or capture with `origin: "document"` and document coordinates. Pick whichever works on both browsers; one code path.

## Done when

- The test passes on Chrome and Firefox.
- An element taller than the viewport is still captured whole.
