# `browsingContext.locateNodes` — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 3
Depends on: script-call-function (preload-scripts optional)

## Goal

Add CSS, text and accessibility locators, and move element resolution from ad-hoc `document.evaluate` calls to the protocol's own locator command. Existing `page.locator(xpath)` behaviour is unchanged.

```ts
page.locator("//button[@type='submit']")        // unchanged
page.getByCss("form.login input[name=user]")
page.getByText("Sign in", { match: "full" })
page.getByRole("button", { name: "Submit" })
page.locator("//form").getByRole("textbox")     // chained, scoped to the form
```

## Non-goals

- Shadow-DOM piercing beyond what the browser's `locateNodes` does natively.
- A custom selector-string mini-language (`role=button[name=…]`); constructors only.
- `getByLabel`, `getByPlaceholder`, `getByTestId`; each is a one-line CSS/xpath wrapper, added later.

## Components

### Selector model — `src/locator/selector.ts` (new)

```ts
export type Selector =
  | { kind: "xpath"; value: string }
  | { kind: "css"; value: string }
  | { kind: "text"; value: string; match: "full" | "partial"; ignoreCase: boolean }
  | { kind: "role"; role: string; name?: string };

export function toBiDiLocator(selector: Selector): BrowsingContext.Locator;
export function describeSelector(selector: Selector): string; // used in every error message
```

`describeSelector` output: xpath → the normalised xpath (unchanged from today, so existing error texts and tests keep passing); css → `css=form input`; text → `text="Sign in"`; role → `role=button[name="Submit"]`. A chain is described `parent >> child`.

Mapping: xpath → `{type:"xpath"}`, css → `{type:"css"}`, text → `{type:"innerText", value, matchType, ignoreCase}`, role → `{type:"accessibility", role, name}`.

### `Locator` changes

- Constructor takes `Selector[]` (a chain) instead of an xpath string; `new Locator(xpath, …)` callers keep working via `Page.locator(xpath)` which builds `[{kind:"xpath", …}]`.
- New: `getByCss`, `getByText`, `getByRole`, `locator(xpath)` on `Locator` (chaining). Each returns a new `Locator` whose chain is the parent chain plus one selector.
- `resolveOne(): Promise<ElementHandle | null>`: for each selector in the chain call `browsingContext.locateNodes { context, locator, maxNodeCount: 1, startNodes }` where `startNodes` is the previous result as a `SharedReference`; return null when any step is empty.
- `resolveAll(): Promise<ElementHandle[]>`: intermediate steps use every match as `startNodes`; the last step has no `maxNodeCount`. Results de-duplicated by `sharedId`, document order kept as returned.
- `count()`, `all()` use `resolveAll`. `all()` returns locators pinned to an element via a `{kind: "handle"}` internal selector (never exposed) instead of the `(xpath)[n]` trick, so non-xpath selectors also support `all()`.
- The actionability probe takes the element as a `callFunction` argument (`probeElement(el, options)`) instead of resolving the xpath in page code. A `no such node` reply (element replaced between resolve and probe) is treated as "not attached" for that poll.
- One poll = `locateNodes` + one `callFunction`: two round trips instead of one. To keep the cost down, `resolveOne` caches the last `ElementHandle` per action; the next poll reuses it and only re-resolves after `no such node`.

### Accessibility locator caveats

- `accessibility` requires a role and/or name; both empty throws `TypeError` at construction.
- Support and exact name computation differ per browser. If Firefox rejects the locator type with `unsupported operation`, `getByRole` throws `UnsupportedOperationError("getByRole is not supported by <browser>")` instead of retrying until the timeout.

## Errors

| Situation | Behaviour |
|---|---|
| Invalid CSS / xpath | `BiDiError` `invalid selector` → thrown immediately (not retried), message includes `describeSelector` |
| No match | as today: retried until the action/assert timeout, then the existing `ActionTimeoutError` (“was not attached”) |
| Unsupported locator type | `UnsupportedOperationError` |

## Testing

- Unit: `toBiDiLocator` / `describeSelector` for every kind and for chains; chain resolution sends `startNodes` from the previous step; multi-match parents are unioned and de-duplicated; cached handle reused then re-resolved after a `no such node` stub reply; invalid selector not retried.
- Existing `locator-actions`, `expect-locator`, `element-state` tests pass unchanged (xpath behaviour, messages).
- Browser: css, text (full vs partial, case), role+name against a fixture page; chained locator scoped to one of two forms; `all()` on a css locator; element replaced mid-wait is re-resolved and clicked.
- TDD: tests first.

## Implementation notes

Deviations and details settled while implementing:

- **No handle cache across polls (replaces the "cache the last `ElementHandle`" idea).** Firefox keeps a removed node resolvable while it is alive, so a cached handle would keep probing a detached element, and it would also miss that a different element became the first match. Every poll searches again: one `locateNodes` (limited to 1 node) plus one `callFunction`. The probe checks `el.isConnected`, so a resolvable-but-removed node reads as not attached. `no such node` between the search and the call also reads as missing/not attached.
- **Locating asks for references only:** `serializationOptions: { maxDomDepth: 0 }`.
- **`nth` steps replace pinned handles for `all()`.** `all()` on a locator that is a single xpath keeps returning positional xpaths (`(//li)[n]`, unchanged); every other locator gets a `nth=<index>` step that re-resolves the whole chain and picks the n-th match (0-based), so items survive re-renders. The step before `nth` is never limited by `maxNodeCount`. No internal `handle` selector exists.
- **Chained xpaths are scoped:** in a chain, `input` and `//input` become `.//input`; absolute (`/…`), grouped (`(…)`) and `./…` paths are kept.
- **Defaults:** `getByText` matches fully and case-sensitively (BiDi's defaults); `match: "partial"` and `ignoreCase: true` are opt-in. `describeSelector` adds `(partial, ignoring case)` only for non-default options.
- **`Locator` takes `string | Selector[]`**, so `new Locator(xpath, …)` keeps working; `selector` prints the chain (`//form >> role=button[name="Save"]`).
- **New API:** `Locator.locator/getByCss/getByText/getByRole` (chaining) and `Page.getByCss/getByText/getByRole`; `InvalidSelectorError` (browser answered `invalid selector`, thrown at once, never retried) and `UnsupportedOperationError` are exported from `locator.ts`.
- **What Firefox (153) supports:** `css`, `xpath` and `accessibility` natively; **`innerText` is `unsupported operation`.** So `getByRole` (role and/or name) works as designed, and text search has a fallback: `TEXT_LOCATE` (`src/locator/text-locator.ts`), an in-page function that searches the descendants of the start nodes (or the whole document), compares `innerText` with whitespace collapsed (`full` = equal, `partial` = substring, optional lower-casing), returns only the innermost matches, unique and in document order. It is tried only after the browser said `unsupported operation`; the answer is remembered per connection, so later text locators go straight to the page. Other locator types that come back unsupported still raise `UnsupportedOperationError`.
- Cost of the text fallback: it reads `innerText` of every element under the roots, so it is linear in page size times depth; fine for test pages, not for very large DOMs.
- The actionability probe is now `PROBE_ELEMENT = (el, options) => …` (element as argument, `DETACHED_STATE` for a missing element) and the framework helpers install it unchanged.
- Test infrastructure: the stub connector answers `browsingContext.locateNodes` (`nodeCounts`, `failLocate`, `unsupportedLocators`, `{ error }` responses). Tests that read the xpath from script text now read it from the locate command.
- Tests: `locator/{selector,text-locator,locator-chain}.test.ts`, updated `locator*.test.ts`/`element-state.test.ts`/`expect-locator.test.ts`, `locator/locate-nodes.browser-test.ts` (real Firefox, port 9235).
