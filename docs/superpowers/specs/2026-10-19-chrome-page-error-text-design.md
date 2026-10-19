# Unhandled rejection text differs

Date: 2026-10-19
Status: implemented (Task 3)
Part of: [Chrome support](../chrome-support-todo.md), item 11

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `an unhandled promise rejection is reported as a page error too (Firefox)`: Chrome reports `Uncaught (in promise) Error: nobody catches me`, the test expects `Error: nobody catches me`.

Affects: page-logs (1 test).

## Cause

- Chrome prefixes a rejection's text with `Uncaught (in promise) `. A format difference, not a missing event.

## Proposal

- Strip the known prefix when building `PageError.message`, so page errors read the same on both browsers. Users compare these messages in assertions.

## Done when

- The test passes on both browsers (rename it: it is not Firefox-only any more).
- The prefixes handled are listed in a comment next to the code.
