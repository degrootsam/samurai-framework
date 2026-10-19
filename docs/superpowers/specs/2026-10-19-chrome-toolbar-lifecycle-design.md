# The recorder toolbar does not come back on a new document

Date: 2026-10-19
Status: implemented (Task 13)
Part of: [Chrome support](../chrome-support-todo.md), item 12

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `draws in a closed shadow root and says it is ready, once per document`: `Timed out waiting for ready #2`.
- `stays out of iframes`: `Timed out waiting for ready #2`.
- `a page whose CSP forbids inline styles still gets a styled toolbar in its spot` also failed in the second full run (it passed in the first); same file, same preload path.
- The first `ready` arrives, so the toolbar does appear once.

Affects: toolbar (2 tests).

## Result (Task 13)

Reproduced with a probe preload script: on Chrome the preload runs in every new document (the element it adds is there each time) and the sandbox realm is created, but the messages of a channel that a preload script in a _sandbox_ was given never arrive; without a sandbox they do. A channel handed to a call into the same sandbox works, which is why the first `ready` (from the immediate run) came and the second never did.

Fix: on Chrome, `addPreload` for a script with a sandbox and channels also runs it, with its channels, in every new window realm of that sandbox (`script.realmCreated`), inside the registered contexts. The toolbar script already keeps one host per document and reports on the newest channel, so the second run only attaches the channel. The registration still draws the toolbar at document start. Unit tests cover the Chrome-only behaviour and its limits (other sandboxes, other pages, workers, Firefox, after dispose). `toolbar.browser-test.ts`: the closed-shadow-root and iframe tests pass; the drag test is spec 13.

## Cause (original reading)

- Hypothesis: the toolbar is injected with a preload script and reports through a `script.message` channel. On Chrome the preload script does not run in the next document, or the channel does not deliver after a navigation (Chrome creates a new execution context).

## Proposal

- Reproduce: navigate, then list `script.realmCreated` and the registered preload scripts. Fix in `src/recorder/toolbar` (re-subscribe the channel per realm) or in the preload registration (`contexts` versus `userContexts`).

## Done when

- Both tests pass on Chrome; the toolbar is on every top-level document and absent from iframes.
- Spec 14 starts after this, because it shares the channel.
