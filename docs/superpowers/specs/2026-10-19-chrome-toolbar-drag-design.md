# Dragging the toolbar rail drops at the wrong y

Date: 2026-10-19
Status: implemented (Task 14)
Part of: [Chrome support](../chrome-support-todo.md), item 13

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `dragging the grip moves the rail and reports where it was dropped`: dropped at y 204, expected 250 (x is right at 200).

Affects: toolbar (1 test).

## Result (Task 14)

Not a drag bug. The pointer events were right (the page saw every move, ending at the right place). The test before it sets a 600×400 viewport and resets it with `setViewport(null)`, which is the window's own size: 780×437 in headless Chrome (Firefox's is bigger). The toolbar keeps the rail inside the window, so a rail 232 px tall could not go lower than 437 - 232 = 205, and the drop was clamped to 204. The toolbar did the right thing; the test now ends with `applyDefaultViewport()` (1280×720), so the later tests do not depend on the browser's window size. Alone, the drag test already passed on Chrome.

## Cause (original reading)

- Hypothesis: `input.performActions` pointer moves use a different origin on Chrome (viewport versus element), or fractional coordinates differ. The 46 px gap is not a scrollbar (15 px), so it is probably the origin.
- Needs a repro that logs the pointer coordinates the page receives.

## Proposal

- Find which of `origin`, window offset or pixel ratio changes the coordinates; fix the conversion in the drag implementation, not the test.

## Done when

- The drop position equals the pointer position on both browsers (±1 px).
