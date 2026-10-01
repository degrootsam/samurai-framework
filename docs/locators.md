# Locators

A locator describes how to find an element. It is lazy: nothing is searched when you create one, and the search is repeated on every action, so a locator keeps working when the page re-renders.

```ts
const save = page.getByRole("button", { name: "Save" });
await save.click();
```

## Ways to find elements

Available on `page` and on every locator (on a locator they search inside its matches).

| Method                       | Finds                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `getByRole(role, { name? })` | Elements with an ARIA role, optionally with an accessible name. Uses the browser's accessibility tree |
| `getByLabel(text, options?)` | Form controls whose `<label>` (`for=` or wrapping), `aria-labelledby` or `aria-label` matches         |
| `getByText(text, options?)`  | The innermost elements whose text matches                                                             |
| `getByTestId(id)`            | Elements whose `data-testid` attribute equals `id`                                                    |
| `getByCss(selector)`         | Elements matching a CSS selector                                                                      |
| `locator(xpath)`             | Elements matching an XPath. A relative path (`button[@type='submit']`) gets a leading `//`            |

`getByText` and `getByLabel` take `{ match: "full" | "partial", ignoreCase: boolean }`. The default is a full, case-sensitive match after collapsing whitespace. `getByText("Save")` does not match "Save draft"; use `{ match: "partial" }` for that.

Empty strings are rejected with a `TypeError`.

## Chaining

Each step searches inside the previous step's matches:

```ts
const form = page.locator("//form[@id='signup']");
await form.getByLabel("Email").fill("a@example.com");
await form.getByRole("button").click(); // the button inside that form
```

In a chained XPath, `//x` and `x` both mean "x inside the parent".

## Picking one of many

An action works on the **first** match. To work with every match:

```ts
const rows = page.getByCss("table tr");
const count = await rows.count();
for (const row of await rows.all()) {
  // one locator per element, in document order
  console.log(await row.textContent());
}
```

`all()` pins each locator to the element that matched at that moment.

## Fallback locators

`withFallbacks` tries the primary locator first and, whenever it matches nothing, each fallback in order. The first one with a match wins:

```ts
const save = page
  .getByTestId("save")
  .withFallbacks(
    page.getByRole("button", { name: "Save" }),
    page.getByText("Save"),
  );

await save.click();
console.log(save.matchedBy); // { index: 1, selector: 'role=button[name="Save"]' }
```

- It is evaluated on every poll, so the primary is preferred again as soon as it matches.
- `matchedBy` says which locator matched last (`0` is the primary), or `undefined` when nothing matched. A self-healing layer can use it to notice that the primary has gone stale.
- A chained step on a locator with fallbacks applies to every alternative: `save.getByCss("span")` means "span inside the primary, or inside any fallback".
- Error messages name every alternative: `testid="save" or role=button[name="Save"]`.

## Actions

Actions wait until the element is **actionable** before they act, then fail with a message that says which check was failing.

| Action                           | Waits for                                                    | Does                                                                    |
| -------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `click(options?)`                | attached, visible, stable (not moving), enabled, not covered | Scrolls into view, clicks the centre with real pointer input            |
| `fill(value, options?)`          | attached, visible, enabled, editable, not covered            | Clicks the field, selects its content and types `value`; `""` clears it |
| `focus(options?)`                | attached                                                     | Focuses the element                                                     |
| `setInputFiles(files, options?)` | attached, enabled (need not be visible)                      | Sets the files of an `<input type=file>`; `[]` clears them              |
| `screenshot(options?)`           | attached, visible                                            | Screenshot of just this element                                         |

Options for `click`, `fill` and `focus`:

```ts
await button.click({ timeout: 10_000 }); // ms to keep trying; default: expect.timeout (5000)
await button.click({ force: true }); // skip every check except "attached"
await button.click({ timeout: 0 }); // check once, don't wait
```

`fill` types key by key, so the page's `input` and `keydown` handlers run. `setInputFiles` paths are resolved against the working directory and must exist on the machine the browser runs on:

```ts
await page.getByLabel("Avatar").setInputFiles("./fixtures/avatar.png");
await page.locator("input[@type='file']").setInputFiles(["a.png", "b.png"]); // needs `multiple`
```

## Reading

These don't wait; they read the element as it is now.

| Method                    | Returns                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `textContent()`           | Trimmed text, or `null` when the element is missing                     |
| `inputValue()`            | Value of an input, textarea or select, or `null`                        |
| `getAttribute(name)`      | Attribute value, or `null` when the element or the attribute is missing |
| `isVisible()`             | Whether the element exists, has a box and isn't hidden by CSS           |
| `isEnabled()`             | Whether the element exists and isn't disabled                           |
| `isEditable()`            | Whether it exists and accepts typing                                    |
| `count()`                 | Number of matching elements                                             |
| `getBoundingClientRect()` | The element's box; throws when it is missing                            |

To _wait_ for a value, use an [assertion](assertions.md).

## Waiting for state

```ts
await spinner.waitFor({ state: "hidden", timeout: 10_000 });
```

States: `"visible"` (default), `"hidden"` (not attached counts), `"attached"`, `"detached"`. It does not scroll.

## Errors

- **`ActionTimeoutError`**: the element didn't become actionable in time. The message names the failing checks (`visible`, `stable`, `hit target`, …) and, for a covered element, what covers it.
- **`InvalidSelectorError`**: the browser rejected the CSS or XPath. Thrown at once, not retried.
- **`UnsupportedOperationError`**: the browser doesn't implement that kind of locator (for example `getByRole` on a browser without the accessibility locator).

## Scope and limits

Locators search the top-level document. They don't pierce iframes, and shadow DOM only as far as the browser's own `locateNodes` does.
