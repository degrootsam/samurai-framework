# More assertions — design

Date: 2026-10-22
Status: design, not built
Roadmap: wiki Roadmap → "Open: framework API" → Assertions ("No `toBeHidden`, `toBeEnabled`, `toBeChecked`, `toHaveCSS`, `toHaveURL`, `toHaveTitle`, `toHaveClass`; no screenshot comparison. Use `expect(await page.url())` for the URL and title.")

## Intent

Tests written by hand, edited in the app and recorded with the toolbar all need assertions on an element's state
(hidden, enabled, checked, class, a CSS value) and on the page (URL, title). Today a test author falls back to
`expect(await page.url())` or custom code, which doesn't retry and which the step editor shows as a `custom` step.

## Goals (the owner's)

Seven new matchers, in all three layers:

1. **Framework `expect`** — usable in specs.
2. **Step codec** (`src/steps/`) — parsed into structured steps (not `custom`), emitted back, editable in the app.
3. **Recorder toolbar** — offered when recording.

Matchers: `toBeHidden`, `toBeEnabled`, `toBeChecked`, `toHaveClass`, `toHaveCSS`, `toHaveURL`, `toHaveTitle`.

## Non-goals

- Screenshot comparison (`toHaveScreenshot`), explicitly out.
- Other Playwright matchers (`toBeDisabled`, `toBeEditable`, `toBeFocused`, `toHaveId`, `toHaveJSProperty`, …):
  `.not.toBeEnabled()` covers disabled.
- Soft assertions, `expect.poll`, custom messages.

## Anti-goals

- A matcher that checks once instead of retrying: every new matcher waits like `toBeVisible` does today.
- A recorded URL assertion that only passes on the environment it was recorded on.

## Decisions

### Framework (`src/assert/`)

Every new matcher retries until it passes or the expect timeout ends (`resolveTimeout`, as today), supports `.not`
(retries until the condition is false), is tracked by `pending-assertions` (an un-awaited matcher fails the test),
and throws `AssertionError` with `matcher`, `expected`, `actual` and the locator (or `page`) on failure. Same
`options?: { timeout?: number }` as the existing matchers.

Element matchers on `LocatorAssertions` (my calls on semantics, following Playwright where it has one):

| Matcher | Passes when |
| --- | --- |
| `toBeHidden()` | the locator matches no element, or the element is not visible (the opposite of `isVisible`) |
| `toBeEnabled()` | the same rule the actionability checks use (`src/locator/element-state.ts`): `!el.matches(":disabled")` (which covers a disabled `<fieldset>`) and no `aria-disabled="true"` on the element. Reuse that probe; do not change it, so `toBeEnabled` and `click` never disagree |
| `toBeChecked()` | a checkbox or radio input with `checked`, or an element with `aria-checked="true"` |
| `toHaveClass(expected: string \| RegExp)` | the `class` attribute: a string equals it after collapsing whitespace and trimming **both sides**; a RegExp matches the attribute as written |
| `toHaveCSS(name: string, expected: string \| RegExp)` | `getComputedStyle(el).getPropertyValue(name)`, with a camelCase `name` turned into kebab-case first (`backgroundColor` → `background-color`; custom properties `--x` kept): a string equals it; a RegExp matches it |

Page matchers — a new `expect(page: Page)` overload returning `PageAssertions` (`not`, same options):

| Matcher | Passes when |
| --- | --- |
| `toHaveURL(expected: string \| RegExp)` | `await page.url()`: a RegExp matches the full URL; a string starting with `/`, `./` or `../` is resolved against the base URL first (the page's `setBaseURL`, else the environment's `baseURL`, the same rule `page.goto` uses) and then must equal the full URL; any other string must equal the full URL |
| `toHaveTitle(expected: string \| RegExp)` | `await page.title()`: a string equals it (trimmed); a RegExp matches it |

**A locator that matches no element** (resolved after review): `toBeHidden` passes, as above. For the other four,
a missing element is never a pass, with or without `.not`: they keep retrying and, at the timeout, fail with the
existing "could not read <selector> within Nms" error. (So `.not.toBeEnabled()` does not pass for an element that
isn't there.)

`expect(page)` is told apart from a plain value the way a `Locator` is (`instanceof Page`). Reading the URL or
title of a closed page fails the matcher with the page error, not a timeout.

### Step codec (`src/steps/`)

- `Expectation` (element assertions, step kind `expect`, which already has `locator`, `not`, `expectation`) gains:
  - `{ matcher: "toBeHidden" | "toBeEnabled" | "toBeChecked" }`
  - `{ matcher: "toHaveClass"; expected: TextMatcher }`
  - `{ matcher: "toHaveCSS"; name: string; expected: TextMatcher }`
- New step kind for page assertions: `{ kind: "expectPage"; not: boolean; expectation: PageExpectation }` with
  `PageExpectation = { matcher: "toHaveURL" | "toHaveTitle"; expected: TextMatcher }`. Source:
  `await expect(page).toHaveURL("/checkout");`, `await expect(page).not.toHaveTitle(/Error/);`.
- Parse and emit round-trip for every new form, with the same rules as today: a statement whose shape differs
  (extra arguments, options, variables) stays `custom`.
- `expected` stays a literal or regex (`TextMatcher`), as for the existing text matchers; no `env.`/`secrets.` values.

### Recorder toolbar (`src/recorder/toolbar/`)

- The Assert panel (Alt+click / pick) gets five buttons, after the existing ones: "Hidden", "Enabled", "Checked",
  "Has class", "Has CSS". `inspect.ts` adds to the panel info what decides availability and the prefill:
  - "Checked": only for a checkbox or radio input, or an element with `role` checkbox/radio/switch or `aria-checked`.
  - "Enabled": only for form controls, buttons and elements with `aria-disabled`.
  - "Has class": only when the element has a `class`; prefill: its class string.
  - "Has CSS": always; the panel takes a property name (default `color`) and prefills its computed value.
  - "Hidden": always offered; it's the element as it will be after later steps, so its "Not" default stays off.
- Page assertions: a new "Page" entry in the toolbar rail opens an "Assert page" panel with two options, "URL" and
  "Title", the existing "Not" checkbox and "Add".
  - **URL (the owner's decision): recorded relative to `baseURL`.** The prefill is the shortest string starting
    with `/` (path, query and hash, as the page has them) that `toHaveURL` resolves back to exactly the current
    URL: build `pathname + search + hash` when the URL has the base URL's origin, and keep it only if
    `new URL(candidate, base).href === url`; otherwise prefill the full URL. (Resolved after review: the
    recorder's `relative()` for `goto` strips the base string, which breaks under a base URL with a path or a
    rest starting with `?`; the assertion must use this round-trip rule instead.) A recording with no base URL
    prefills the full URL. The person can edit it before adding.
  - Title: prefilled with `page.title()`.
  - The URL and title come from the recorder side (`page.url()` / `page.title()` of the recorded top-level page),
    not from the toolbar's frame; the toolbar asks for them over its protocol, like the Assert panel's element info.
    Adding sends a new observation (`expectPage`) through the normaliser, which writes the step.
- Adding writes an `expect` / `expectPage` step through the recorder like the existing assertions do.

### Capabilities

Two keys, both turned on in the **codec PR** (the second), so the app never sees a key before the project's codec
parses what it promises: `assertionMatchers: 2` (a number, so later matcher sets can raise it; 1 = today's set) for
the new element matchers, and `pageAssertions: true` for `expect(page)` and the `expectPage` step kind. The toolbar
PR adds no key (the toolbar runs from the same copy that has the codec).

## Constraints

- Repo rules (`CLAUDE.md`): branch from up-to-date `main`; npm scripts for tests; tsc/knip/madge clean; PR with
  real counts; browser tests on Firefox and Chrome (CI runs both).
- The step codec stays pure. The toolbar's page script is plain JS in template strings (`source/*.ts`); follow its
  existing slices and `data-action` handlers.
- `.not` and pending-assertion tracking must behave exactly like the existing matchers.

## Testing

- Framework: browser tests per matcher, positive and `.not`, against data-URL pages: an element that becomes
  hidden/enabled/checked after a delay passes; one that never does fails with an `AssertionError` naming the
  matcher; `toHaveURL` with a `/path` after `setBaseURL`, a full URL, a RegExp; `toHaveTitle` after a title change.
  Unit tests where a matcher's comparison is pure (class normalisation, URL resolution).
- Codec: parse/emit round-trip for every new form, `not` included; non-matching shapes stay `custom`.
- Toolbar: controller unit tests for availability, prefill and the steps written; one browser test per new panel
  path (an element assertion, a page URL assertion relative to `baseURL`).

## Shipping

Three PRs, in order, each with its tests: framework matchers; codec; toolbar (with the capabilities keys in the
PR that completes each). Then the wiki (Assertions page, Steps and the recorder, the roadmap item) and a hand-off
to the app (new step kind `expectPage`, new `Expectation` members, capability keys).

## Left to the builder

- Exact visibility and "disabled" helpers (reuse the locator's existing visibility code).
- Toolbar layout and labels beyond the names above; how the CSS property field looks.
- File layout (a `page-assertions.ts` next to `locator-assertions.ts` is the obvious one).
