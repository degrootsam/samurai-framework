# Semantic locators — design

Date: 2026-10-01
Status: implemented
Roadmap item: 2 (phase 1)
Depends on: locate-nodes

## Goal

Locators a recorder can emit and a tester can read, plus an ordered list of fallback locators per step (the input for self-healing).

```ts
page.getByRole("button", { name: "Save" })   // existing
page.getByText("Save")                        // existing
page.getByLabel("Email address")              // new
page.getByTestId("save")                      // new
page.getByTestId("save").withFallbacks(
  page.getByRole("button", { name: "Save" }),
  page.getByText("Save"),
);
```

`getByLabel` and `getByTestId` also exist on `Locator` (chained, scoped to the parent's matches).

## Components

- **`getByTestId(id)`**: selector kind `testid`, sent to the browser as the CSS `[data-testid="…"]` (quotes and backslashes escaped). The attribute name is fixed to `data-testid`.
- **`getByLabel(text, { match, ignoreCase })`**: selector kind `label`. BiDi has no label locator, so the framework searches in the page (`src/locator/label-locator.ts`, same approach as the text fallback). An element's labels are its `<label>`s (`el.labels`: `for=` and nesting), the elements named by `aria-labelledby`, and `aria-label`. Whitespace is collapsed; `full` (default) needs equality, `partial` a substring. Results are unique, in document order.
- **`withFallbacks(...locators)`**: returns a locator with the same chain plus ordered alternatives. Every search tries the primary chain; only when it matches nothing, each alternative in order; the first with a match wins. Fallbacks are tried on every poll, so the primary is preferred again as soon as it matches.
  - `matchedBy`: `{ index, selector }` of the locator that matched last (0 = primary), `undefined` when nothing matched. A self-healing layer reads it to see the primary has gone stale.
  - Chaining (`getByCss`, `getByLabel`, …) on a locator with fallbacks applies the step to every alternative.
  - `all()` pins to the first alternative that matches.
  - Error messages name every alternative: `css=#a or css=#b`.

## Non-goals

- A configurable test-id attribute; `getByPlaceholder`, `getByAltText`. Each is a small selector kind, added when needed.
- Ranking or verifying locators (recorder engine, item 4).
