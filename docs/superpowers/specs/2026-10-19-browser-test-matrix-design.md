# Run the browser tests on either browser

Date: 2026-10-19
Status: approved
Part of: [Chrome support](../chrome-support-todo.md), item 00

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- Every `*.browser-test.ts` hard-codes `Browser.launch("firefox", …)` (24 call sites), so Chrome can only be tried by editing the tests. The first Chrome run used `sed` for this and was reverted afterwards.
- The first full run hung for 12 minutes after the computer slept: `test:browser` has no per-test timeout.

Affects: All browser tests; this is the prerequisite for the other specs.

## Cause

- The browser name is a literal in each test file, and a test that asserts a Firefox limit (`unsupported by this Firefox`) has no way to say it is Firefox-only.

## Proposal

- `SAMURAI_TEST_BROWSER=firefox|chrome` (default `firefox`) read by one helper, `testBrowser()`, in `src/testing/browser-fixture.ts`. Every browser test launches through it.
- `bun run test:browser:chrome` runs the suite on Chrome. CI keeps running Firefox and gets a Chrome job once the suite is green.
- A test that is true of one browser only says so, with wrappers around `test` (decided: wrappers, not plain `test.skip`):
  - `onlyOn("firefox", reason, name, fn)` runs on Firefox only.
  - `skipOn("chrome", reason, name, fn)` runs on every browser except Chrome.
  - On the other browser the test is reported as skipped, with the reason in its name, so the run summary counts it and says why. No silent `if`s inside tests.
- Tests that assert a Firefox limit become two assertions: the Firefox limit stays, and Chrome asserts that the option works or throws `UnsupportedOperationError` (see spec 05).
- `--test-timeout=60000` on `test:browser` (decided).

## Done when

- Both `bun run test:browser` and `bun run test:browser:chrome` work with no file edits.
- Skips are listed with their reason in the run output.
- A hung test fails after 60 s instead of blocking the run.
