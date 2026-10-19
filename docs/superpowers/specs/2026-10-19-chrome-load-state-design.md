# waitForLoadState after a link click, and its timeout error

Date: 2026-10-19
Status: approved
Part of: [Chrome support](../chrome-support-todo.md), item 07

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `a link click followed by waitForLoadState ends up on the loaded target` fails after 150 ms. The assertion text was not captured.
- `waitForLoadState times out with its own error`: 30 s, the timeout error never comes.
- `navigation.browser-test.ts` did not finish in 150 s. chromedriver logged `Unable to receive message from renderer` (a page that never answers, made on purpose by the test).

Affects: navigation (2 tests, plus the rest of the file after the hang).

## Cause

- Step one is a rerun that captures the failure detail of the first test.
- Hypothesis for the hang: a never-finishing response keeps the renderer busy and chromedriver closes the BiDi socket before the framework's timer fires.

## Proposal

- A closed socket must reject a pending wait with `ConnectionClosedError` at once, not wait for its own timeout.
- Check whether `pageLoadStrategy: "none"` in the chromedriver capabilities stops chromedriver interfering with navigation; the framework does its own load waits.

## Done when

- The file finishes on Chrome in under 60 s.
- A navigation to a page that never answers fails with the framework's timeout error, not a socket error.

## Open questions

- Decided: try `pageLoadStrategy: "none"` in the repro and keep it only if it changes the outcome. It tells chromedriver not to wait for page loads in its own classic commands; the framework navigates over BiDi with its own wait, so it should be harmless, but it should not stay as an unexplained flag.
