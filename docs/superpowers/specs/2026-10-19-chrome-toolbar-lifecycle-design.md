# The recorder toolbar does not come back on a new document

Date: 2026-10-19
Status: approved
Part of: [Chrome support](../chrome-support-todo.md), item 12

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `draws in a closed shadow root and says it is ready, once per document`: `Timed out waiting for ready #2`.
- `stays out of iframes`: `Timed out waiting for ready #2`.
- `a page whose CSP forbids inline styles still gets a styled toolbar in its spot` also failed in the second full run (it passed in the first); same file, same preload path.
- The first `ready` arrives, so the toolbar does appear once.

Affects: toolbar (2 tests).

## Cause

- Hypothesis: the toolbar is injected with a preload script and reports through a `script.message` channel. On Chrome the preload script does not run in the next document, or the channel does not deliver after a navigation (Chrome creates a new execution context).

## Proposal

- Reproduce: navigate, then list `script.realmCreated` and the registered preload scripts. Fix in `src/recorder/toolbar` (re-subscribe the channel per realm) or in the preload registration (`contexts` versus `userContexts`).

## Done when

- Both tests pass on Chrome; the toolbar is on every top-level document and absent from iframes.
- Spec 14 starts after this, because it shares the channel.
