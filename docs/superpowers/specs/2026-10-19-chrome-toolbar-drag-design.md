# Dragging the toolbar rail drops at the wrong y

Date: 2026-10-19
Status: approved
Part of: [Chrome support](../chrome-support-todo.md), item 13

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `dragging the grip moves the rail and reports where it was dropped`: dropped at y 204, expected 250 (x is right at 200).

Affects: toolbar (1 test).

## Cause

- Hypothesis: `input.performActions` pointer moves use a different origin on Chrome (viewport versus element), or fractional coordinates differ. The 46 px gap is not a scrollbar (15 px), so it is probably the origin.
- Needs a repro that logs the pointer coordinates the page receives.

## Proposal

- Find which of `origin`, window offset or pixel ratio changes the coordinates; fix the conversion in the drag implementation, not the test.

## Done when

- The drop position equals the pointer position on both browsers (±1 px).
