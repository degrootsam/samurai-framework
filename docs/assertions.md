# Assertions

`expect(...)` has two forms, chosen by what you pass in.

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
```

| Matcher                           | Passes when                                                 |
| --------------------------------- | ----------------------------------------------------------- |
| `toBeVisible()`                   | The element exists, has a box and isn't hidden              |
| `toHaveText(expected)`            | Trimmed text content equals a string, or matches a `RegExp` |
| `toContainText(expected)`         | Text content contains a string, or matches a `RegExp`       |
| `toHaveValue(expected)`           | The input's value equals a string, or matches a `RegExp`    |
| `toHaveAttribute(name, expected)` | The attribute equals a string, or matches a `RegExp`        |
| `toHaveCount(n)`                  | Exactly `n` elements match                                  |

- Every matcher takes `{ timeout }` as its last argument: `await expect(x).toBeVisible({ timeout: 15_000 })`.
- `.not` inverts: it retries until the condition is **false**.
- Text is the element's `textContent`, trimmed. A missing element never matches (so `toHaveText("")` fails on a missing element).

When an assertion times out the error shows the matcher, the locator, what was expected and the last value seen.

## Plain values: `expect(value)`

Synchronous; they throw straight away.

```ts
expect(await page.title()).toBe("Home");
expect(await page.url()).toMatch(/\/home$/);
expect(items).toEqual(["a", "b"]);
expect(count).toBeGreaterThan(0);
```

`toBe` (strict identity), `toEqual` (deep equality), `toBeTruthy`, `toBeFalsy`, `toContain`, `toMatch(string | RegExp)` (a string means "contains"), `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, and `.not` for each. The numeric matchers throw a `TypeError` when given non-numbers.

## Failures

Failed assertions throw an `AssertionError` carrying `matcher`, `expected`, `actual` and, for elements, the locator. The report stores them under the test's error with `type: "assertion"`, so tools can show expected against actual.
