<!-- markdownlint-disable MD041 -->

`expect(...)` has three forms, chosen by what you pass in: a locator, the page, or a plain value.

## Elements: `expect(locator)`

These retry until the condition holds or the timeout passes (default `expect.timeout`, 5 s). Always `await` them: a matcher that isn't awaited fails the test.

```ts
await expect(page.getByTestId("status")).toHaveText("Saved");
await expect(page.getByRole("alert")).toContainText(/error/i);
await expect(page.getByLabel("Name")).toHaveValue("Sam");
await expect(page.getByRole("link", { name: "Docs" })).toHaveAttribute(
  "href",
  "/docs",
);
await expect(page.getByCss("li.item")).toHaveCount(3);
await expect(page.getByText("Loading")).not.toBeVisible();
await expect(page.getByText("Spinner")).toBeHidden();
await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
await expect(page.getByLabel("Remember me")).toBeChecked();
await expect(page.getByRole("tab", { name: "Billing" })).toHaveClass(/active/);
await expect(page.getByRole("button", { name: "Save" })).toHaveAccessibleName(
  "Save",
);
await expect(page.getByLabel("Password")).toHaveAccessibleDescription(
  /at least 8/,
);
await expect(page.getByTestId("banner")).toHaveCSS(
  "background-color",
  "rgb(255, 0, 0)",
);
```

| Matcher                                 | Passes when                                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toBeVisible()`                         | The element exists, has a box and isn't hidden                                                                                                                                                  |
| `toHaveText(expected)`                  | Trimmed text content equals a string, or matches a `RegExp`                                                                                                                                     |
| `toContainText(expected)`               | Text content contains a string, or matches a `RegExp`                                                                                                                                           |
| `toHaveValue(expected)`                 | The input's value equals a string, or matches a `RegExp`                                                                                                                                        |
| `toHaveAttribute(name, expected)`       | The attribute equals a string, or matches a `RegExp`                                                                                                                                            |
| `toHaveCount(n)`                        | Exactly `n` elements match                                                                                                                                                                      |
| `toBeHidden()`                          | No element matches, or it isn't visible (from 0.19.0)                                                                                                                                           |
| `toBeEnabled()`                         | The element isn't disabled: not `:disabled` (a disabled `<fieldset>` counts) and no `aria-disabled="true"`; the same check `click` and `fill` wait for (from 0.19.0)                            |
| `toBeChecked()`                         | A checked checkbox or radio, or `aria-checked="true"` (from 0.19.0)                                                                                                                             |
| `toHaveClass(expected)`                 | The `class` attribute equals a string (whitespace collapsed on both sides), or matches a `RegExp` (from 0.19.0)                                                                                 |
| `toHaveAccessibleName(expected)`        | The accessible name equals a string (whitespace collapsed and trimmed on both sides), or matches a `RegExp` (from 0.21.3)                                                                       |
| `toHaveAccessibleDescription(expected)` | The accessible description equals a string (compared the same way), or matches a `RegExp`; a missing description is `""` (from 0.21.3)                                                          |
| `toHaveCSS(name, expected)`             | The computed style value equals a string or matches a `RegExp`; `backgroundColor` and `background-color` both work. Browsers report computed values, so `red` is `rgb(255, 0, 0)` (from 0.19.0) |

- Every matcher takes `{ timeout }` as its last argument: `await expect(x).toBeVisible({ timeout: 15_000 })`.
- `.not` inverts: it retries until the condition is **false**.
- Text is the element's `textContent`, trimmed. A missing element never matches (so `toHaveText("")` fails on a missing element).
- `toBeEnabled`, `toBeChecked`, `toHaveClass`, `toHaveCSS`, `toHaveAccessibleName` and `toHaveAccessibleDescription` need the element: when nothing matches they fail, with or without `.not`, with "could not read … within …ms". So `.not.toBeEnabled()` does not pass for an element that isn't there; `toBeHidden()` does.

When an assertion times out the error shows the matcher, the locator, what was expected and the last value seen.

### Saving what passed as an output

From 0.21.0. `toHaveText`, `toContainText`, `toHaveValue` and `toHaveAttribute` take `{ output }` next to `{ timeout }`: the value that passed is saved as that output of the running test. A `RegExp` saves its first capture group, else its whole match; a string saves the whole value read.

```ts
await expect(page.getByTestId("order")).toHaveText(/Order #(\d+)/, {
  output: "orderId",
});
```

The test must declare the output, the matcher can't be negated (`expect(locator).not.toHaveText: output can't be saved from a negated check`), and it only works inside a test. See [Inputs and outputs](Writing-tests#inputs-and-outputs).

## The page: `expect(page)`

From 0.19.0. These retry like the element matchers, take `{ timeout }`, support `.not` and must be awaited.

```ts
await expect(page).toHaveURL("/checkout");
await expect(page).toHaveURL(/\/orders\/\d+$/);
await expect(page).not.toHaveTitle(/Error/);
```

| Matcher                 | Passes when                                                                                                                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toHaveURL(expected)`   | A `RegExp` matches the full URL. A string starting with `/`, `./` or `../` is resolved against the base URL exactly as `page.goto` resolves it (`page.setBaseURL`, else the environment's `baseURL`) and must equal the full URL; any other string must equal the full URL |
| `toHaveTitle(expected)` | The trimmed title equals a trimmed string, or matches a `RegExp`                                                                                                                                                                                                           |

A relative URL with no base URL fails at once ("needs a baseURL"). A read while the page navigates is retried; a closed page fails at once with its error.

## Plain values: `expect(value)`

Synchronous; they throw straight away.

```ts
expect(items).toEqual(["a", "b"]);
expect(count).toBeGreaterThan(0);
```

`toBe` (strict identity), `toEqual` (deep equality), `toBeTruthy`, `toBeFalsy`, `toContain`, `toMatch(string | RegExp)` (a string means "contains"), `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, and `.not` for each. The numeric matchers throw a `TypeError` when given non-numbers.

## Failures

Failed assertions throw an `AssertionError` carrying `matcher`, `expected`, `actual` and, for elements, the locator (`"page"` for page matchers). The report stores them under the test's error with `type: "assertion"`, so tools can show expected against actual.
