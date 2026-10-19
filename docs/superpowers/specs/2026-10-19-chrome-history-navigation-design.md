# goBack / goForward lose the page

Date: 2026-10-19
Status: implemented (Task 7)
Part of: [Chrome support](../chrome-support-todo.md), item 04

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `goBack and goForward walk the history; at the ends they say false`: `script.callFunction failed (unknown error): Cannot find context with specified id`.

Affects: page-api (1 test); anything calling `goBack` / `goForward`.

## Result (Task 7)

Two causes, neither a changed context id (the id stayed the same in the trace):

1. Chrome answers `traverseHistory` before the entry is committed (26 ms, commit at 32 ms; Firefox answers after the commit), so the next script call could hit the document that was going away. `goBack` / `goForward` now watch for `navigationCommitted`, `historyUpdated` or `fragmentNavigated` of this page before they return, and give up waiting after a second (a page restored from the back-forward cache sends no `load`).
2. Chrome keeps a new tab's blank page as a history entry, Firefox does not, so `goBack` from the first page said `true`. Where the Navigation API exists (Chrome), `goBack` says `false` when only that blank page or nothing is behind. A page the person navigated to `about:blank` on purpose, with one more entry before it, is read the same way; that edge is accepted.

## Cause (original reading)

- Hypothesis: after `browsingContext.traverseHistory` Chrome swaps the browsing context (back-forward cache or a cross-process navigation), so the id the `Page` holds is gone when the next script call runs.
- Needs a repro that logs `browsingContext.contextDestroyed` / `contextCreated` around a traversal.

## Proposal

- If the context id changes: `Page` follows the new id. If it is timing: wait for `load` / `historyUpdated` before `goBack` returns.

## Done when

- The test passes on Chrome; `goBack` at the start of history returns `false` without error.
- `Page.id` stays valid after history traversal, or the page documents when it does not.

## Open questions

- Should the fix be Chrome-only (a `Page` that re-binds) or also change Firefox code paths?
