# More Assertions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven new assertions — `toBeHidden`, `toBeEnabled`, `toBeChecked`, `toHaveClass`, `toHaveCSS` on `expect(locator)`, and `toHaveURL`, `toHaveTitle` on a new `expect(page)` — in the framework, the step codec and the recorder toolbar.

**Architecture:** Three stacked PRs: framework matchers (Tasks 1–3), codec (Task 4), toolbar (Tasks 5–6). Element matchers extend `LocatorAssertions`; page matchers live in a new `PageAssertions`. The codec extends `Expectation` and adds an `expectPage` step kind. The toolbar extends the Assert panel and adds a Page panel, writing through new observations the normaliser turns into steps.

**Tech Stack:** TypeScript (ESM), node:test via `tsx`, WebDriver BiDi, the `typescript` compiler API in the codec, plain-JS toolbar source in template strings.

**Spec:** `docs/superpowers/specs/2026-10-22-assertions-design.md` (local, git-ignored).

## Global Constraints

- Every new matcher retries until it passes or `resolveTimeout(options?.timeout)` ends, supports `.not`, is tracked by `track()` (`src/assert/pending-assertions.ts`), and fails with `AssertionError({ matcher, expected, actual, locator })` (for page matchers `locator: "page"`). Options: `{ timeout?: number }`.
- A locator that matches no element: `toBeHidden` passes; `toBeEnabled`, `toBeChecked`, `toHaveClass`, `toHaveCSS` never pass, with or without `.not`, and fail at the timeout with the existing `expect(locator).<name>: could not read <selector> within <n>ms` error.
- `toBeEnabled` uses the existing probe rule in `src/locator/element-state.ts` (`!el.matches(":disabled") && aria-disabled !== "true"`); that probe is not changed.
- `toHaveClass`: a string compares after collapsing whitespace and trimming both sides; a RegExp tests the attribute as written.
- `toHaveCSS(name, …)`: camelCase `name` → kebab-case (`backgroundColor` → `background-color`); `--custom` kept; value is `getComputedStyle(el).getPropertyValue(name)`.
- `toHaveURL`: RegExp tests the full URL; a string starting with `/`, `./`, `../` resolves against the page's base URL (the same base `page.goto` uses) and must equal the full URL; any other string must equal it. `toHaveTitle`: string equals the trimmed title; RegExp tests it.
- Codec stays pure; statements of any other shape stay `custom`. `expected` is a `TextMatcher` (literal or regex).
- Capabilities `assertionMatchers: 2` and `pageAssertions: true` are added in the codec PR (Task 4), not earlier.
- Recorded URL prefill: `pathname + search + hash` only if the URL has the base URL's origin and `new URL(candidate, base).href === url`; else the full URL; no base URL → full URL.
- Repo rules (`CLAUDE.md`): branch from up-to-date `main`; npm scripts for tests (`npm test`; `npm run build` then `npm run test:cli`; `npm run test:browser`, `npm run test:browser:chrome`); `npx tsc --noEmit --noUnusedLocals`, `npx knip`, `npx madge --circular --extensions ts src` clean; stage named paths; commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR body Summary + Test plan with real counts.

## Review Focus

- `.not` on a missing element for the four "must exist" matchers passes by accident if the read returns `null` and `check(null)` is false (today's `assertEventually` does `check(actual) !== negated`). Test: `.not.toBeChecked()` on a missing element fails with "could not read" (Task 1).
- `toHaveURL("/checkout")` after `page.setBaseURL("https://x.com/app/")` must resolve like `goto` (to `https://x.com/checkout`); the recorder prefill must never produce a relative URL that resolves elsewhere. Tests: Task 2 (resolution) and Task 5 (prefill with a base that has a path, and with a URL whose rest starts with `?`).
- A page assertion on a page that navigates mid-check keeps retrying rather than failing on a read during navigation (Task 2 browser test: title changes after a delayed navigation).
- `toHaveCSS` with a value the browser normalises (`red` → `rgb(255, 0, 0)`): the toolbar prefill uses the computed value so recorded assertions pass (Task 5 test).
- An un-awaited `expect(page).toHaveURL(...)` fails the test like an un-awaited locator matcher (Task 2 unit test via `takePendingAssertions`).

---

### Task 1: Element matchers in the framework

**Files:**
- Modify: `src/assert/locator-assertions.ts`, `src/locator/locator.ts` (read helpers), `src/assert/text-match.ts` (class comparison helper if it fits there)
- Test: `src/assert/expect-locator.test.ts` (stubConnector unit tests), Create `src/assert/assertions.browser-test.ts`

**Interfaces:**
- Produces on `LocatorAssertions`: `toBeHidden(options?)`, `toBeEnabled(options?)`, `toBeChecked(options?)`, `toHaveClass(expected: string | RegExp, options?)`, `toHaveCSS(name: string, expected: string | RegExp, options?)`, all returning `Promise<void>`.
- Produces on `Locator`: `isChecked(): Promise<boolean | null>`, `cssValue(name: string): Promise<string | null>` (null when no element), and a way for `toBeEnabled` to read `null` when there is no element (e.g. `isEnabled` variant or a count check — implementer's choice, documented).
- `assertEventually` gains a flag so a `null` read never counts as a pass (both polarities) for the "must exist" matchers.

- [ ] **Step 1: Write failing unit tests** (stubConnector, in `expect-locator.test.ts`): `toBeHidden` passes on a missing element and on a not-visible one; `.not.toBeHidden` retries until visible; `toBeEnabled` retries until the probe says enabled; `.not.toBeChecked()` on a missing element rejects with `/could not read .* within/`; `toHaveClass("a  b ")` passes for attribute `" a b"`; `toHaveClass(/^a/)` tests the raw attribute; `toHaveCSS("backgroundColor", "rgb(0, 0, 0)")` reads `background-color`; failures throw `AssertionError` with the matcher name (`not.toBeChecked` for negated).
- [ ] **Step 2: Write failing browser tests** in `assertions.browser-test.ts` (pattern: `src/runner/screenshots.browser-test.ts` / `testing/test-browser.js` helpers, a data-URL page): a button disabled for 300 ms then enabled passes `toBeEnabled`; a checkbox checked after 300 ms passes `toBeChecked`; `role="switch" aria-checked="true"` passes; an element hidden after 300 ms passes `toBeHidden`; `toHaveCSS("color", "rgb(255, 0, 0)")` on `style="color:red"`; each `.not` counterpart.
- [ ] **Step 3:** Run `npm test` (unit) → new tests fail; run the browser file → fails.
- [ ] **Step 4:** Implement the matchers and Locator helpers.
- [ ] **Step 5:** `npm test`; the browser file on Firefox and Chrome (`SAMURAI_TEST_BROWSER=chrome`); tsc, knip, madge.
- [ ] **Step 6: Commit** `feat: toBeHidden, toBeEnabled, toBeChecked, toHaveClass and toHaveCSS`.

### Task 2: `expect(page)` with `toHaveURL` and `toHaveTitle`

**Files:**
- Create: `src/assert/page-assertions.ts`
- Modify: `src/assert/expect.ts` (overload `expect(page: Page): PageAssertions`, dispatch on `instanceof Page`), `src/browser/page.ts` (expose the base URL resolution `goto` uses as a method, e.g. `resolveURL(url: string): Promise<string>`, reused by `goto`), `src/api.ts` if types are exported there
- Test: Create `src/assert/expect-page.test.ts` (unit, with a fake page object exposing `url()`, `title()`, `resolveURL()` — or the real resolution as a pure helper), extend `src/assert/assertions.browser-test.ts`

**Interfaces:**
- Consumes: `track`, `resolveTimeout`, `waitUntil`, `AssertionError` as Task 1.
- Produces: `class PageAssertions { get not(); toHaveURL(expected: string | RegExp, options?); toHaveTitle(expected: string | RegExp, options?) }`; `expect(page)` returns it.

- [ ] **Step 1: Write failing unit tests**: a pure URL helper — `"/checkout"` with base `https://x.com/app/` → `https://x.com/checkout`; `"./b"` → `https://x.com/app/b`; a full URL unchanged; a RegExp tests the full URL. `toHaveTitle("Home ")` vs title `" Home"` passes. An un-awaited `expect(page).toHaveURL("x")` appears in `takePendingAssertions()`. `expect(page).not.toHaveTitle("Home")` retries until it changes.
- [ ] **Step 2: Write failing browser tests**: `toHaveURL("/b")` after `setBaseURL` and a delayed `location.href` change; `toHaveURL(/#done$/)`; `toHaveTitle("Done")` after a title set in a 300 ms timeout; a failing `toHaveURL` throws `AssertionError` with `matcher: "toHaveURL"`, `locator: "page"`.
- [ ] **Step 3:** Run → fail. **Step 4:** Implement. **Step 5:** `npm test`, the browser file on both browsers, tsc/knip/madge, `npm run build` + `npm run test:cli`.
- [ ] **Step 6: Commit** `feat: expect(page) with toHaveURL and toHaveTitle`.

### Task 3: Framework PR

- [ ] Branch `feat/assertions` from `origin/main` (Tasks 1–2 committed on it); push; open PR "feat: seven more assertions in expect" (Summary lists the matchers and the missing-element rule; Test plan with counts). No capabilities key yet. Controller task: no code.

### Task 4: Codec — element matchers and the `expectPage` step

**Files:**
- Modify: `src/steps/model.ts` (`Expectation` members; `PageExpectation`; `Step` member `{ kind: "expectPage"; not: boolean; expectation: PageExpectation }`), `src/steps/parse/expectation.ts` (`readExpectation`; new `readPageExpectation`), `src/steps/parse/step.ts` (parse `expect(page)…` and `expect(page).not…`), `src/steps/emit.ts` (`expectationToSource`, `stepToSource` for `expectPage`), `src/steps/build.ts` if it runs steps by kind, `src/steps/index.ts` (export `PageExpectation`), `src/capabilities.ts` + test (`assertionMatchers: 2`, `pageAssertions: true`), any exhaustive `switch` over step kinds the compiler flags (recorder/flows step runners)
- Test: `src/steps/steps.test.ts` (round-trip style already there)

**Interfaces:**
- Produces: `Expectation` adds `{ matcher: "toBeHidden" | "toBeEnabled" | "toBeChecked" }`, `{ matcher: "toHaveClass"; expected: TextMatcher }`, `{ matcher: "toHaveCSS"; name: string; expected: TextMatcher }`. `PageExpectation = { matcher: "toHaveURL" | "toHaveTitle"; expected: TextMatcher }`. Step `expectPage`.

- [ ] **Step 1: Write failing round-trip tests**: for each of `await expect(page.getByRole("button", { name: "Save" })).toBeHidden();`, `.not.toBeEnabled()`, `.toBeChecked()`, `.toHaveClass("a b")`, `.toHaveClass(/active/)`, `.toHaveCSS("color", "rgb(255, 0, 0)")`, `await expect(page).toHaveURL("/checkout");`, `await expect(page).not.toHaveTitle(/Error/);` — `parseSpec` gives the structured step and `stepToSource` gives the statement back byte for byte. Shapes that stay `custom`: `toBeHidden({ timeout: 1 })`, `toHaveCSS("color")`, `toHaveURL(url)` (a variable), `expect(other).toHaveURL("/")`. Capabilities deep-equal includes the two keys.
- [ ] **Step 2:** Run → fail. **Step 3:** Implement. **Step 4:** `npm test`, tsc/knip/madge, build + `test:cli`, recorder browser tests (`src/recorder/*.browser-test.ts`) on Firefox.
- [ ] **Step 5: Commit** `feat: the codec reads and writes the new assertions and expectPage`; branch `feat/assertions-codec` from `feat/assertions`; PR based on it.

### Task 5: Toolbar — element matchers in the Assert panel

**Files:**
- Modify: `src/recorder/toolbar/protocol.ts` (`MatcherChoice` += five; `assert` message gets `cssName?: string`; `PickInfo` gets what availability/prefill need: `checkable: boolean`, `disableable: boolean`, `className: string | null`, `css: { name: string; value: string }` default `color`), `src/recorder/toolbar/inspect.ts` (`INSPECT_SOURCE` computes them; computed CSS read for a name on request), `src/recorder/toolbar/actions/assert.ts` (new cases), `src/recorder/toolbar/source/setup.ts` (`MATCHERS` += `["toBeHidden","Hidden"]`, `["toBeEnabled","Enabled"]`, `["toBeChecked","Checked"]`, `["toHaveClass","Has class"]`, `["toHaveCSS","Has CSS"]`), `src/recorder/toolbar/source/views-panels.ts` (`unavailable`, `prefill`, the CSS name field), `src/recorder/toolbar/source/handlers.ts` (CSS name change re-reads the value)
- Test: `src/recorder/toolbar/controller-assert.test.ts`, `src/recorder/toolbar/toolbar.browser-test.ts`

**Interfaces:**
- Consumes: Task 4's `Expectation` members.
- Produces: the panel availability rules from the spec: Checked only when `checkable`; Enabled only when `disableable` (form controls, buttons, `aria-disabled` present); Has class only when `className`; Has CSS and Hidden always.

- [ ] **Step 1: Write failing tests**: controller — each new matcher choice writes the matching `expect` step (Has CSS with `cssName: "background-color"` and the prefilled computed value); Has CSS without a name fails "Choose a CSS property". Browser — on a checkbox the Checked button is enabled and on a `<p>` disabled; Has CSS prefill for `style="color:red"` reads `rgb(255, 0, 0)` and the added step passes when the test runs.
- [ ] **Step 2:** Run → fail. **Step 3:** Implement. **Step 4:** controller tests, toolbar browser tests on Firefox and Chrome, `npm test`, tsc/knip/madge.
- [ ] **Step 5: Commit** `feat: the toolbar's Assert panel offers the new element assertions`.

### Task 6: Toolbar — the Page panel

**Files:**
- Modify: `src/recorder/toolbar/protocol.ts` (messages `{ action: "page-info" }` answered with `{ ok: true; url: string; urlPrefill: string; title: string }`, and `{ action: "assert-page"; matcher: "toHaveURL" | "toHaveTitle"; expected: string; not: boolean }` answered with `ActionReply`), `src/recorder/expectation.ts` (`urlForAssertion(url: string, base: string | undefined): string` — the round-trip rule), `src/recorder/toolbar/controller.ts` (handle both; read `page.url()` / `page.title()` of the recorded page), Create `src/recorder/toolbar/actions/assert-page.ts`, `src/recorder/normalise.ts` (observation `{ type: "expectPage"; not: boolean; expectation: PageExpectation }` → step `expectPage`), toolbar source (`setup.ts` rail entry "Page", `views-panels.ts` panel with URL/Title options, Not, Add; `handlers.ts`)
- Test: `src/recorder/expectation.test.ts`, `src/recorder/normalise.test.ts`, `src/recorder/toolbar/controller-assert.test.ts`, `src/recorder/toolbar/toolbar.browser-test.ts`

**Interfaces:**
- Consumes: Task 4's `expectPage` step and `PageExpectation`.
- Produces: `urlForAssertion(url, base)`.

- [ ] **Step 1: Write failing tests**: `urlForAssertion("https://x.com/checkout?a=1#b", "https://x.com")` → `"/checkout?a=1#b"`; with base `https://x.com/app` and URL `https://x.com/app/checkout` → `"/app/checkout"` (resolves back exactly); URL `https://x.com?a=1` with base `https://x.com` → `"/?a=1"`; other origin → full URL; no base → full URL. Normaliser: an `expectPage` observation becomes an `expectPage` step. Controller: `page-info` answers url/urlPrefill/title; `assert-page` writes the step; empty expected fails "Fill in the value". Browser: the Page panel adds `await expect(page).toHaveURL("/…")` relative to the recording's base URL, and a Title assertion.
- [ ] **Step 2:** Run → fail. **Step 3:** Implement. **Step 4:** unit + toolbar browser tests on Firefox and Chrome, `npm test`, tsc/knip/madge, build + `test:cli`.
- [ ] **Step 5: Commit** `feat: the toolbar asserts the page's URL and title`; branch `feat/assertions-toolbar` (Tasks 5–6) from `feat/assertions-codec`; PR based on it.

### Task 7: Docs and hand-off (controller)

- [ ] After release: wiki Assertions page (each matcher, the missing-element rule, `expect(page)`), Steps and the recorder (new `Expectation` members, `expectPage`), Recorder toolbar section, Roadmap (remove the Assertions gap except screenshot comparison), "Upgrading to …". Hand-off to the app: `expectPage` step kind, new `Expectation` members (the editor must render them), capability keys `assertionMatchers: 2`, `pageAssertions`.
