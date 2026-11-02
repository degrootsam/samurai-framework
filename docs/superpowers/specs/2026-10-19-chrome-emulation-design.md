# Emulation options that do nothing on Chrome

Date: 2026-10-19
Status: implemented (Task 8)
Part of: [Chrome support](../chrome-support-todo.md), item 05

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `userAgent changes navigator.userAgent…`: the page still reports `HeadlessChrome/155.0.0.0`.
- `screen changes screen.width and screen.height`: `[800, 600]` before and after.
- `touch and javaScriptEnabled are reported as unsupported by this Firefox`: no rejection (the call succeeds; not shown whether it takes effect).
- `newContext refuses an unsupported option…`: no `UnsupportedOperationError`.

Affects: emulation (4 tests).

## Result (Task 8)

The open question had a good answer: on Chrome 155 every option takes effect (locale, timezone, userAgent, screen, touch, orientation, offline, javaScriptEnabled; checked by reading the value from the page after each call). The four failing tests were test assumptions, not framework bugs:

- `userAgent` expected `/Firefox/` after the reset; it now compares with the user agent read before the override.
- `screen` used 800×600 as the pretend size, which is also headless Chrome's real screen; it now uses 1111×777 and compares with the original.
- `touch` / `javaScriptEnabled` and the `newContext` refusal assert Firefox limits (`onlyOn("firefox")`); Chrome has `skipOn("firefox")` counterparts that check the values are applied, and the invalid-timezone check is a neutral test.

No framework change. The docs say which browser supports which option.

## Cause (original reading)

- Two real questions: do the user-agent and screen overrides apply on Chrome 155 (the calls succeed, nothing changes), and do touch and `javaScriptEnabled` really work. A silent success that changes nothing is the worst outcome for a test framework.
- The last two tests only encode Firefox's limits and need the browser-aware variants from spec 00.

## Proposal

- Per option, confirm with a page read that the value is applied. If the mapper accepts it but ignores it, throw `UnsupportedOperationError` instead of succeeding.
- Workarounds only if cheap (UA via `network.setExtraHeaders` plus a preload script override); otherwise document the option as Firefox-only.

## Done when

- Each emulation option either takes effect on Chrome or throws `UnsupportedOperationError` naming Chrome.
- `docs/pages-and-browsers.md` lists which options each browser supports.

## Open questions

- If an option can't be supported on Chrome: Firefox-only with a clear error (proposed), or an escape hatch to chromedriver's CDP endpoint?
