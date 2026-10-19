# goBack / goForward lose the page

Date: 2026-10-19
Status: approved
Part of: [Chrome support](../chrome-support-todo.md), item 04

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `goBack and goForward walk the history; at the ends they say false`: `script.callFunction failed (unknown error): Cannot find context with specified id`.

Affects: page-api (1 test); anything calling `goBack` / `goForward`.

## Cause

- Hypothesis: after `browsingContext.traverseHistory` Chrome swaps the browsing context (back-forward cache or a cross-process navigation), so the id the `Page` holds is gone when the next script call runs.
- Needs a repro that logs `browsingContext.contextDestroyed` / `contextCreated` around a traversal.

## Proposal

- If the context id changes: `Page` follows the new id. If it is timing: wait for `load` / `historyUpdated` before `goBack` returns.

## Done when

- The test passes on Chrome; `goBack` at the start of history returns `false` without error.
- `Page.id` stays valid after history traversal, or the page documents when it does not.

## Open questions

- Should the fix be Chrome-only (a `Page` that re-binds) or also change Firefox code paths?
