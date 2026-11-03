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

| Matcher                                 | Passes when                                                                                                                                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toBeVisible()`                         | The element exists, has a box and isn't hidden; `{ visible: false }` expects the opposite, as `toBeHidden()`                                                                                                            |
| `toHaveText(expected)`                  | Text content equals a string (whitespace runs collapsed, both sides trimmed), or matches a `RegExp` (tested on the trimmed text); an array takes one entry per matched element                                          |
| `toContainText(expected)`               | Text content contains a string (whitespace collapsed on both sides), or matches a `RegExp`; an array finds its entries in order among the elements                                                                      |
| `toHaveValue(expected)`                 | The input's value equals a string, or matches a `RegExp`                                                                                                                                                                |
| `toHaveAttribute(name, expected?)`      | The attribute equals a string, or matches a `RegExp`; with only a name, the attribute exists (even when empty)                                                                                                          |
| `toHaveCount(n)`                        | Exactly `n` elements match                                                                                                                                                                                              |
| `toBeHidden()`                          | No element matches, or it isn't visible (from 0.19.0)                                                                                                                                                                   |
| `toBeEnabled()`                         | The element isn't disabled (`{ enabled: false }` expects it disabled): not `:disabled` (a disabled `<fieldset>` counts) and no `aria-disabled="true"`; the same check `click` and `fill` wait for (from 0.19.0)         |
| `toBeChecked()`                         | A checked checkbox or radio, or `aria-checked="true"` (from 0.19.0). `{ checked: false }` expects it unchecked, `{ checked: "mixed" }` or `{ indeterminate: true }` an indeterminate checkbox or `aria-checked="mixed"` |
| `toHaveClass(expected)`                 | The `class` attribute equals a string (whitespace collapsed on both sides), or matches a `RegExp` (from 0.19.0)                                                                                                         |
| `toBeDisabled()`                        | The element is disabled (the opposite of `toBeEnabled()`)                                                                                                                                                               |
| `toBeEditable()`                        | The element accepts typing: enabled, not `readonly`, a text field, textarea or `contenteditable`; `{ editable: false }` expects the opposite                                                                            |
| `toBeAttached()`                        | At least one element matches; `.not.toBeAttached()` or `{ attached: false }` waits until none does                                                                                                                      |
| `toBeFocused()`                         | The element is the active element of its document or shadow root                                                                                                                                                        |
| `toBeInViewport({ ratio })`             | Part of the element is inside the viewport; with `ratio` (0 to 1), at least that share of it                                                                                                                            |
| `toBeEmpty()`                           | An input or textarea with an empty value; any other element has no element children and no text besides whitespace                                                                                                      |
| `toHaveId(expected)`                    | The `id` equals a string or matches a `RegExp`                                                                                                                                                                          |
| `toHaveJSProperty(name, value)`         | The element's JavaScript property deep-equals `value` (`toHaveJSProperty("count", 3)`); the value must be something `evaluate` can copy out of the page                                                                 |
| `toHaveAccessibleName(expected)`        | The accessible name equals a string (whitespace collapsed and trimmed on both sides), or matches a `RegExp` (from 0.21.3)                                                                                               |
| `toHaveAccessibleDescription(expected)` | The accessible description equals a string (compared the same way), or matches a `RegExp`; a missing description is `""` (from 0.21.3)                                                                                  |
| `toHaveCSS(name, expected)`             | The computed style value equals a string or matches a `RegExp`; `backgroundColor` and `background-color` both work. Browsers report computed values, so `red` is `rgb(255, 0, 0)` (from 0.19.0)                         |

- Every matcher takes `{ timeout }` as its last argument: `await expect(x).toBeVisible({ timeout: 15_000 })`.
- `.not` inverts: it retries until the condition is **false**.
- Text is the element's `textContent`, trimmed. A string expectation is compared with runs of whitespace collapsed to one space on both sides, so `toHaveText("Hello big world")` matches `"Hello\n   big world"`; a `RegExp` is tested on the trimmed text as the page has it. A missing element never matches (so `toHaveText("")` fails on a missing element).
- With an array, `toHaveText` needs as many elements as entries, compared in order (`[]` matches no element at all); `toContainText` needs each entry, in order, in a different element, with others allowed in between. `{ output }` can't be used with an array.
- `toBeEnabled`, `toBeDisabled`, `toBeChecked`, `toBeEditable`, `toBeFocused`, `toBeInViewport`, `toBeEmpty`, `toHaveId`, `toHaveJSProperty`, `toHaveClass`, `toHaveCSS`, `toHaveAccessibleName` and `toHaveAccessibleDescription` need the element: when nothing matches they fail, with or without `.not`, with "could not read … within …ms". So `.not.toBeEnabled()` does not pass for an element that isn't there; `toBeHidden()` and `toBeAttached` with `.not` do.
- The matchers that read the element with a script of their own (`toBeFocused`, `toBeInViewport`, `toBeEmpty`, `toHaveId`, `toHaveJSProperty`, `toBeChecked` with `"mixed"`) look at the first match and don't enforce strict selectors.

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

A relative URL with no base URL fails at once ("needs a baseURL"). A read while the page navigates is retried; a closed page fails at once with its error. To wait for a URL without asserting it, use [`page.waitForURL`](Pages-and-browsers#waiting-for-the-url).

## Plain values: `expect(value)`

Synchronous; they throw straight away.

```ts
expect(items).toEqual(["a", "b"]);
expect(count).toBeGreaterThan(0);
expect(user).toMatchObject({ id: expect.any(Number), name: "Sam" });
expect(() => parse("{")).toThrow(/Unexpected/);
```

- `toBe` (strict identity), `toEqual` (deep equality), `toBeTruthy`, `toBeFalsy`, `toContain`, `toMatch(string | RegExp)` (a string means "contains"), `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual`. The numeric matchers throw a `TypeError` when given non-numbers.
- `toMatchObject(subset)`: the object has the properties of `subset`, nested objects likewise; arrays must have the same length and each item is matched the same way.
- `toContainEqual(item)`: the array has an item that `toEqual` `item`.
- `toBeNull()`, `toBeUndefined()`, `toBeDefined()` (`null` counts as defined).
- `toHaveLength(n)`: a string, array or array-like; a failure shows the length found.
- `toBeCloseTo(number, digits = 2)`: the difference is under half a unit of the last digit, as in Jest.
- `toBeInstanceOf(Class)`.
- `toThrow(expected?)`: the function throws; `expected` is a string (the message contains it), a `RegExp` (the message matches), a class (`instanceof`) or an `Error` (the message is equal). It calls a synchronous function: there is no `rejects` for promises. Use `expect.poll` or `toPass` to wait.
- `.not` for each.

`toEqual` compares like Node's `assert.deepStrictEqual`: `{ a: 1, b: undefined }` does **not** equal `{ a: 1 }`, where Jest's `toEqual` ignores a property that is `undefined`. Use `toMatchObject` to leave properties out.

### Asymmetric matchers

Placeholders for the parts of an expected value you don't want to spell out, usable inside `toEqual`, `toMatchObject` and `toContainEqual` (in arrays and plain objects, at any depth; not inside a `Map` or `Set`):

| Matcher                         | Matches                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expect.any(Class)`             | An instance of `Class`; `String`, `Number`, `Boolean`, `BigInt` and `Symbol` match primitives, `Object` any non-null object, `Function` a function |
| `expect.anything()`             | Anything but `null` and `undefined`                                                                                                                |
| `expect.stringContaining(text)` | A string that contains `text`                                                                                                                      |
| `expect.stringMatching(re)`     | A string that matches the `RegExp` (or a string compiled to one)                                                                                   |
| `expect.arrayContaining(items)` | An array with an equal item for each of `items`, in any order                                                                                      |
| `expect.objectContaining(obj)`  | An object with each key of `obj` and an equal value; other keys are fine                                                                           |

There is no `expect.not.*` variant.

### Retrying: `expect.poll` and `toPass`

`expect.poll(fn)` calls `fn` (sync or async) again and again and checks each value with any matcher above, until one passes or the timeout (default: the expect timeout, 5 s) runs out. `.not` works. A function that throws counts as a failed try; a misused matcher (a `TypeError`) fails at once. A timeout fails with the last value seen. `timeout: 0` tries once.

```ts
await expect.poll(() => readQueueLength(), { timeout: 10_000 }).toBeLessThan(5);
await expect
  .poll(async () => (await fetchOrder(id)).status, { message: "order status" })
  .toBe("shipped");
```

Options: `timeout`, `intervals` (pauses in ms between tries, the last one repeating; default `[100, 250, 500, 1000]`), `message` (replaces the first line of the failure). Always `await` it.

`expect(fn).toPass()` runs a block (sync or async) until it stops throwing, for several checks that must hold together:

```ts
await expect(async () => {
  await expect(page.getByTestId("total")).toHaveText("$12");
  expect(await readBackend()).toMatchObject({ paid: true });
}).toPass({ timeout: 10_000 });
```

Unlike the other waits its **default timeout is 0**: one try, as in Playwright, so pass a `timeout` to retry. A failure rethrows the last error as it was. `.not.toPass()` waits until the block throws. Always `await` it.

## Failures

Failed assertions throw an `AssertionError` carrying `matcher`, `expected`, `actual` and, for elements, the locator (`"page"` for page matchers). The report stores them under the test's error with `type: "assertion"`, so tools can show expected against actual.
