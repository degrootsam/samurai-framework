<!-- markdownlint-disable MD041 -->

A locator describes how to find an element. It is lazy: nothing is searched when you create one, and the search is repeated on every action, so a locator keeps working when the page re-renders.

```ts
const save = page.getByRole("button", { name: "Save" });
await save.click();
```

## Ways to find elements

Available on `page` and on every locator (on a locator they search inside its matches).

| Method                                  | Finds                                                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getByRole(role, options?)`             | Elements with an ARIA role, optionally with an accessible name and state (see [Roles](#roles))                                                                                         |
| `getByLabel(text, options?)`            | Form controls whose `<label>` (`for=` or wrapping), `aria-labelledby` or `aria-label` matches                                                                                          |
| `getByText(text, options?)`             | The innermost elements whose text matches                                                                                                                                              |
| `getByPlaceholder(text, { exact? })`    | Elements whose `placeholder` attribute matches                                                                                                                                         |
| `getByAltText(text, { exact? })`        | Elements whose `alt` attribute matches (images, areas, image inputs)                                                                                                                   |
| `getByTitle(text, { exact? })`          | Elements whose `title` attribute matches                                                                                                                                               |
| `getByTestId(id)`                       | Elements whose `data-testid` attribute equals `id`                                                                                                                                     |
| `getByCss(selector)`                    | Elements matching a CSS selector                                                                                                                                                       |
| `locator(selector, { has?, hasText? })` | Elements matching a CSS selector or an XPath, told apart by the string (see [CSS or XPath](#css-or-xpath)); the options filter the matches like [`filter()`](#narrowing-and-combining) |

`getByText`, `getByLabel`, `getByPlaceholder`, `getByAltText` and `getByTitle` take a string or a `RegExp`. A `RegExp` is tested on the text as written (its `g` and `y` flags are dropped) and ignores `exact`.

### Exact or loose

A string is matched in full and case-sensitively, after collapsing whitespace, so `getByText("Save")` does not match "Save draft". Pass `exact: false` for a case-insensitive substring match with whitespace normalised:

```ts
page.getByText("Save"); // "Save", not "Save draft" and not "save"
page.getByText("save", { exact: false }); // "Save", "Save draft", "SAVE"
page.getByLabel(/^e-?mail$/i); // a RegExp
```

This is the one deliberate difference from Playwright, whose default is the loose match. `exact` defaults to `true` here so that locators written before it existed keep matching what they matched. The same `exact` option exists on `getByRole`'s `name`. `getByText` and `getByLabel` also take `{ match: "full" | "partial", ignoreCase: boolean }`, which `exact` sets for you (`exact: false` is `partial` plus `ignoreCase`); give them explicitly to mix the two, for example `{ match: "partial" }` for a case-sensitive substring.

Empty strings are rejected with a `TypeError`.

### CSS or XPath

`locator(selector)` reads the string as CSS or as XPath:

- A string starting with `//`, `/`, `(`, `..` or `./`, or with `xpath=`, is XPath.
- A string starting with `css=` is CSS, and so is anything else: `page.locator("h1")`, `page.locator("input[name='email']")`, `page.locator("a, button")`.
- A bare string that cannot be CSS stays XPath, so locators written as relative XPath keep working: one with `@`, `/` or `::` in it, a function call (`text()`) or a positional predicate (`li[2]`, `li[last()]`). Text inside quotes does not count, so `a[href^='/docs']` is CSS. Recorded absolute paths (`/html/body/...`) are unchanged.

A bare tag name such as `h1` was an XPath before and is CSS now; it shows as `css=h1` in error messages. Write `css=` or `xpath=` in front when you want to be explicit. A relative XPath (`button[@type='submit']`) gets a leading `//`.

### Roles

```ts
page.getByRole("button", { name: "Save" });
page.getByRole("link", { name: /docs/i });
page.getByRole("heading", { level: 2 });
page.getByRole("checkbox", { name: "Remember me", checked: true });
```

| Option          | Meaning                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `name`          | The accessible name: a string (full, case-sensitive unless `exact: false`) or a `RegExp`                 |
| `exact`         | `false` makes a string `name` a case-insensitive substring; ignored for a `RegExp`                       |
| `level`         | The heading level: `h1` to `h6`, else `aria-level`                                                       |
| `checked`       | `true`, `false` or `"mixed"`, from the element's own state or `aria-checked`                             |
| `pressed`       | `true`, `false` or `"mixed"`, from `aria-pressed`                                                        |
| `expanded`      | From `aria-expanded` (or an open `<details>`)                                                            |
| `selected`      | An `<option>`'s state, or `aria-selected`                                                                |
| `disabled`      | Disabled by `disabled` (also through a disabled `<fieldset>`) or by `aria-disabled` on it or an ancestor |
| `includeHidden` | Also match elements that are not rendered or are hidden from assistive technology. Default `false`       |

A bad option value is a `TypeError` (`getByRole(): level must be a positive integer`).

How the search runs depends on the options:

- `getByRole(role)` and `getByRole(role, { name: "string" })` use the browser's accessibility locator, so the browser's own accessibility tree decides. The two browsers differ for hidden elements: Firefox leaves out elements hidden with `aria-hidden`, Chrome's locator also returns them.
- Anything richer (a `RegExp` name, `exact: false`, a state option, `includeHidden`) is a search in the page, the same in both browsers. It works out the role from the `role` attribute, else from a table of implicit roles, and compares the accessible name it computes (the same one `accessibleName()` reads). Elements that are not rendered or sit under `aria-hidden="true"` are skipped unless `includeHidden` is set.

The page-side search is a simplified version of the accessibility rules, not a copy of the browser's tree. The role table covers the common HTML elements (a subset of HTML-AAM), and the name computation has no shadow DOM or slot flattening, no `aria-owns` and none of the `<details>` / `<summary>` rules. If a name does not match the way the browser reports it, compare with `await locator.accessibleName()`, or use the plain form of `getByRole`.

## Chaining

Each step searches inside the previous step's matches:

```ts
const form = page.locator("//form[@id='signup']");
await form.getByLabel("Email").fill("a@example.com");
await form.getByRole("button").click(); // the button inside that form
```

In a chained XPath, `//x` and `x` both mean "x inside the parent".

## Picking one of many

An action works on the **first** match. To pick another one:

```ts
const rows = page.getByCss("table tr");
await rows.first().click();
await rows.last().click();
await rows.nth(2).click(); // 0-based
await rows.nth(-2).click(); // from the end: the second to last
```

`nth(i)` counts in document order and matches nothing when `i` is out of range. To work with every match:

```ts
const count = await rows.count();
for (const row of await rows.all()) {
  // one locator per element, in document order
  console.log(await row.textContent());
}
```

`all()` pins each locator to the element that matched at that moment.

## Narrowing and combining

`filter` keeps the matches that pass its tests, in their order. Give at least one of:

| Option       | Keeps the elements                                                         |
| ------------ | -------------------------------------------------------------------------- |
| `hasText`    | whose text contains the string, or matches the `RegExp`                    |
| `hasNotText` | whose text does not                                                        |
| `has`        | that contain a match of the locator, which is searched inside each element |
| `hasNot`     | that contain no match of the locator                                       |

```ts
await page
  .locator("li")
  .filter({ hasText: "paid", has: page.getByRole("button") })
  .first()
  .click();

// the same, as options of locator()
page.locator("li", { hasText: /order #\d+/ });
```

A string `hasText` is a case-insensitive substring with whitespace collapsed; a `RegExp` is tested on the text as written. That is not what `getByText` does with a string (a full, case-sensitive match): `filter` follows Playwright here and `getBy*` keeps its own rule.

`and` and `or` combine two locators of the same page:

```ts
const save = page.getByRole("button").and(page.getByText("Save"));
const field = page.getByLabel("Email").or(page.getByLabel("E-mail"));
```

`and` keeps the elements both locators match, in the first locator's order. `or` returns the elements either one matches, in document order, each once. Both locators must belong to the same page, and a locator with [fallbacks](#fallback-locators) cannot be an operand of `and` or `or`, nor the locator given to `has` or `hasNot`; they throw a `TypeError` that says so.

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

| Action                                      | Waits for                                                          | Does                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `click(options?)`                           | attached, visible, stable (not moving), enabled, not covered       | Scrolls into view, clicks the centre (or `position`) with real pointer input; `button`, `clickCount`, `modifiers`, `delay` shape the click, see below                                                    |
| `fill(value, options?)`                     | attached, visible, enabled, editable, not covered                  | Clicks the field, selects its content and types `value`; `""` clears it                                                                                                                                  |
| `check(options?)`                           | attached, visible, stable, enabled, not covered                    | Checks a checkbox, radio or switch. Does nothing when it is already checked. A hidden input behind a `<label>` is checked by clicking the label                                                          |
| `uncheck(options?)`                         | the same as `check`                                                | Unchecks a checkbox or switch; does nothing when it is already unchecked                                                                                                                                 |
| `setChecked(checked, options?)`             | the same as `check`                                                | `check()` or `uncheck()`, whichever brings the element to `checked`                                                                                                                                      |
| `selectOption(values, options?)`            | attached, visible, enabled                                         | Selects options of a `<select>`; see below                                                                                                                                                               |
| `focus(options?)`                           | attached                                                           | Focuses the element                                                                                                                                                                                      |
| `press(key, options?)`                      | attached, visible, enabled                                         | Focuses the element and presses a key or a chord (`Control+a`) with real keyboard input; see [Keys](#keys-and-chords)                                                                                    |
| `dblclick(options?)`                        | the same as `click`                                                | `click` with two presses: `mousedown`, `mouseup`, `click` twice, then `dblclick`                                                                                                                         |
| `hover(options?)`                           | attached, visible, stable, not covered (enabled is not needed)     | Moves the mouse onto the element: `:hover`, `mouseover`, `mouseenter`, menus and tooltips that show on hover                                                                                             |
| `tap(options?)`                             | the same as `click`                                                | Touches the element with a touch pointer: `pointerdown` with `pointerType: "touch"`, `touchstart`, `touchend`, then the mouse events a tap ends in                                                       |
| `dragTo(target, options?)`                  | source like `click`, target attached, visible, stable, not covered | Presses on the element, moves to `target` in steps and releases there; see [Drag and drop](#drag-and-drop)                                                                                               |
| `dispatchEvent(type, eventInit?, options?)` | attached                                                           | Fires a synthetic event at the element, even a hidden one; see below                                                                                                                                     |
| `blur(options?)`                            | attached                                                           | Removes focus from the element                                                                                                                                                                           |
| `clear(options?)`                           | the same as `fill`                                                 | Empties an input, textarea or editable element, as `fill("")` does                                                                                                                                       |
| `pressSequentially(text, options?)`         | attached, visible, enabled                                         | Focuses the element and types `text` one key press at a time, `delay` ms apart; unlike `fill` it does not select or replace what is there                                                                |
| `setInputFiles(files, options?)`            | attached, enabled (need not be visible)                            | Sets the files of an `<input type=file>`; `[]` clears them. Paths are relative to the project folder; `generatedFile(…)` entries are allowed                                                             |
| `dropFiles(files, options?)`                | attached, visible                                                  | Drops files on the element with synthetic `dragenter`, `dragover` and `drop` events (`isTrusted` is false, so a page that only accepts trusted drops rejects them). Same file entries as `setInputFiles` |
| `screenshot(options?)`                      | attached, visible                                                  | Screenshot of just this element                                                                                                                                                                          |

Options for `click`, `dblclick`, `hover`, `tap`, `dragTo`, `fill`, `clear`, `focus`, `blur`, `press`, `pressSequentially`, `dispatchEvent`, `check`, `uncheck`, `setChecked` and `selectOption`:

```ts
await button.click({ timeout: 10_000 }); // ms to keep trying; default: expect.timeout (5000)
await button.click({ force: true }); // skip every check except "attached"
await button.click({ timeout: 0 }); // check once, don't wait
```

### Click, hover and tap options

`click`, `dblclick`, `hover` and `tap` also take:

```ts
await button.click({ position: { x: 10, y: 5 } }); // pixels from the element's top left corner (default: the centre); that point must be uncovered
await button.click({ button: "right" }); // "left" (default), "middle" or "right"
await button.click({ clickCount: 3 }); // presses in a row; 2 is a double click
await button.click({ delay: 200 }); // ms between press and release (a long press)
await row.click({ modifiers: ["Shift"] }); // "Alt", "Control", "ControlOrMeta" (Meta on macOS), "Meta", "Shift": held during the action
await menu.hover(); // reveals what shows on :hover
await item.tap(); // a touch pointer instead of the mouse
```

`button`, `clickCount` and `delay` are for `click` and `dblclick` (`dblclick` is `click` with `clickCount: 2`); `hover` and `tap` take `position`, `modifiers`, `timeout` and `force`. A bad option throws before the page is touched: `click(): unknown button "back"`. On Chrome a tap is followed by the mouse events and a `contextmenu` with `detail` -1, as Chrome's own touch input does; Firefox sends `mousedown`, `mouseup` and `click` only.

### Keys and chords

`press(key)` takes a key, or a chord: modifiers joined to a key with `+`.

```ts
await field.press("Enter");
await field.press("Control+a"); // select all
await field.press("Shift+Tab");
await field.press("ControlOrMeta+Enter"); // Meta on macOS, Control elsewhere
await field.press("Control++"); // the plus key itself
await field.press("a", { delay: 100 }); // ms between key down and key up
```

Named keys: `Enter`, `Escape`, `Tab`, `Backspace`, `Delete`, `Space`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, `F1` to `F12`, the arrows, and the modifiers `Control`, `Shift`, `Alt` and `Meta`. `KeyA` and `Digit1` mean `a` and `1`. Anything else must be a single character. An unknown key throws `press(): unknown key "Hyper"`. For keys not tied to an element, use [`page.keyboard`](Pages-and-browsers#keyboard-and-mouse).

### Drag and drop

```ts
await page.getByText("Card 1").dragTo(page.getByTestId("done-column"));
await handle.dragTo(page.locator("div[@id='area']"), {
  sourcePosition: { x: 5, y: 5 },
  targetPosition: { x: 300, y: 200 },
  steps: 20, // pointer moves between the two points (default 10)
});
```

`dragTo` waits for both ends (the source like a click, the target to be visible, stable and uncovered), presses on the source, moves to the target in steps and releases, with real pointer input. That is enough for drags a page builds from `mousedown` / `mousemove` / `mouseup` or pointer events.

HTML5 drag and drop (`draggable="true"`, `dragstart`, `dragover`, `drop`) differs per browser:

- **Chrome** runs a real drag: `dragstart`, `drag`, `dragenter`, `dragover`, `drop` and `dragend` are trusted events.
- **Firefox** starts the drag (`dragstart`, `dragenter` and `dragover` are real) but never drops it from synthetic pointer input: no `drop`, no `dragend`. After the gesture `dragTo` fires them itself as synthetic events (`isTrusted` is false) on the target and the source, with a `DataTransfer` that holds what the page's `dragstart` handler stored. As in a real drag, `drop` only fires when the page cancelled `dragover`. A page that accepts only trusted drops does not see the drop on Firefox. When the browser started no drag at all but the source is `draggable="true"`, the whole sequence is fired synthetically.

### dispatchEvent

```ts
await page.getByTestId("card").dispatchEvent("dragstart"); // a DragEvent with a fresh DataTransfer
await field.dispatchEvent("keydown", { key: "k" }); // a KeyboardEvent
await widget.dispatchEvent("ping", { detail: 3 }); // any other type: a plain Event
```

The event class follows the type: mouse types (`click`, `mousedown`, ...) make a `MouseEvent`, `pointer*` a `PointerEvent`, `keydown` / `keyup` a `KeyboardEvent`, `focus` / `blur` a `FocusEvent`, `input` an `InputEvent`, `wheel`, drag, composition, touch, animation and transition types their own classes, anything else an `Event`. `eventInit` is plain data merged over `bubbles`, `cancelable` and `composed`, which are all true. The event is synthetic (`isTrusted` is false) and no visibility, enabled or hit checks apply; use `click` for what a user does.

`fill` types key by key, so the page's `input` and `keydown` handlers run. `setInputFiles` and `dropFiles` paths are relative to the project folder (absolute paths are used as they are) and must exist on the machine the browser runs on:

```ts
await page.getByLabel("Avatar").setInputFiles("files/avatar.png");
await page
  .locator("input[@type='file']")
  .setInputFiles(["files/a.png", "files/b.png"]); // needs `multiple`
await page.getByTestId("dropzone").dropFiles(["files/a.png", "files/b.png"]);
```

### generatedFile

`generatedFile({ name, size, type? })` stands in for a big file you don't want in the repository. The bytes are pseudo-random, the same in every run (seeded with the name and size), and written at run time to `result/files/`, then removed when the run ends. `size` is a number of bytes or a string with a unit (`B`, `KB`, `MB`, `GB`, powers of 1024, for example `"60 MB"`).

```ts
import { generatedFile } from "@itmetsam/samurai-framework";

await page
  .getByLabel("Upload")
  .setInputFiles(
    generatedFile({ name: "huge.pdf", size: "60 MB", type: "application/pdf" }),
  );
```

`type` reaches the page through `dropFiles` only. `setInputFiles` hands the browser a path, so the browser takes the type from the file name's extension.

## Checkboxes, radios and selects

```ts
await page.getByLabel("I accept the terms").check();
await page.getByRole("checkbox", { name: "News" }).setChecked(false);
await page.getByRole("switch", { name: "Dark mode" }).check({ trial: true }); // waits, doesn't click
```

`check`, `uncheck` and `setChecked` take `{ timeout, force, trial }`. They work on native checkboxes and radio buttons and on elements with `role=checkbox`, `radio`, `switch`, `menuitemcheckbox` or `menuitemradio`, which read `aria-checked`. An element already in the target state is left alone: nothing is clicked, and it only has to be attached. `trial: true` waits for the element to be actionable and stops there. The click is real pointer input, and the state is read again afterwards.

They throw when:

- the element is none of the above: `check(): element is not a checkbox, radio, or role=checkbox/radio/switch`;
- you uncheck a radio button: `uncheck(): a radio button cannot be unchecked`;
- the click did not change the state: `check(): clicking the checkbox did not change its state`.

`selectOption` takes a value or a list of them and returns the values that are selected afterwards:

```ts
await page.getByLabel("Country").selectOption("Netherlands"); // a value or a label
await page.locator("select").selectOption({ index: 1 });
const chosen = await page
  .getByLabel("Toppings")
  .selectOption(["cheese", { label: "Olives" }]); // the values now selected
```

A string matches an option's `value` or its label. An object `{ value, label, index }` must match every field you give (`index` is 0-based). In a `<select multiple>` the given options replace the current selection; in a single select the first match is chosen. It focuses the select and fires one `input` and one `change` event. It waits until the select is visible and enabled and every wanted option exists, and takes `{ timeout, force }`. If an option never appears it throws `selectOption(): no option matches "x" in <selector> within 5000ms`, and on anything but a `<select>`, `selectOption(): <selector> is not a <select>`.

## Reading

These don't wait; they read the element as it is now.

| Method                    | Returns                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `textContent()`           | Trimmed text, or `null` when the element is missing                                                                                               |
| `innerText()`             | The rendered text, as a person would copy it (untrimmed, hidden descendants left out), or `null` when the element is missing                      |
| `innerHTML()`             | The markup inside the element, or `null` when the element is missing                                                                              |
| `allTextContents()`       | The `textContent` of every match as the page has it (untrimmed); `[]` when nothing matches                                                        |
| `allInnerTexts()`         | The `innerText` of every match; `[]` when nothing matches                                                                                         |
| `boundingBox()`           | `{ x, y, width, height }` in CSS pixels from the viewport's top left, or `null` when the element is missing or not rendered (`display: none`)     |
| `inputValue()`            | Value of an input, textarea or select, or `null`                                                                                                  |
| `getAttribute(name)`      | Attribute value, or `null` when the element or the attribute is missing                                                                           |
| `isVisible()`             | Whether the element exists, has a box and isn't hidden by CSS                                                                                     |
| `isHidden()`              | The opposite of `isVisible()`: true for a hidden element and for one that is missing                                                              |
| `isEnabled()`             | Whether the element exists and isn't disabled                                                                                                     |
| `isDisabled()`            | The opposite of `isEnabled()`: true for a disabled element and for one that is missing                                                            |
| `accessibleName()`        | The accessible name (`""` when there is none), or `null` when the element is missing                                                              |
| `accessibleDescription()` | The accessible description (`aria-describedby`, else `aria-description`, else `title` when it isn't the name), `""` when there is none, or `null` |
| `isEditable()`            | Whether it exists and accepts typing                                                                                                              |
| `count()`                 | Number of matching elements                                                                                                                       |
| `getBoundingClientRect()` | The element's box; throws when it is missing                                                                                                      |

`textContent()` trims its text; Playwright's does not. That is kept so existing tests keep their results, and `allTextContents()` follows Playwright instead and returns the text untrimmed (trim it yourself when you compare). For a missing element the single-element reads answer `null`, where Playwright waits and then times out. `boundingBox()` does not scroll, so a box below the fold has a `y` larger than the viewport; an element with `visibility: hidden` still has a box. In a strict locator the single-element reads throw for several matches; `allTextContents()`, `allInnerTexts()` and `evaluateAll()` never do.

To _wait_ for a value, use an [assertion](Assertions).

## Running code on the element

```ts
const id = await page.getByTestId("row").evaluate((el) => el.dataset.id);
const total = await page
  .locator("li")
  .evaluate((el, factor) => el.children.length * factor, 3);
const labels = await page
  .locator("li")
  .evaluateAll(
    (els, upper) =>
      els.map((el) => (upper ? el.textContent.toUpperCase() : el.textContent)),
    true,
  );
```

- `evaluate(fn, arg?, { timeout? })` waits until the element is attached (a hidden element is fine), then calls `fn(element, arg)` in the page and returns the result. A missing element ends in the usual `ActionTimeoutError` (`evaluate`, with the selector). A strict locator throws `evaluate(): strict mode violation` for several matches.
- `evaluateAll(fn, arg?)` calls `fn(elements, arg)` with an array of every match, in document order. It does not wait, gives `[]` when nothing matches and ignores strict mode.
- `fn` is a function or the source of one (`"(el) => el.id"`); `arg` is one value: plain objects, arrays, `Date`, `Map`, `Set`, `RegExp`, `BigInt`, `NaN`, `undefined`, and an element reference from an earlier call. Functions, symbols, circular structures and instances of your own classes are refused with a `TypeError` before anything is sent.
- A promise is awaited. If the page function throws, you get a `ScriptError` with the page's own message (`Script threw: Error: ...`), not "Failed to locate element".
- What comes back is described under [Running code in the page](Pages-and-browsers#running-code-in-the-page). The page function runs in the page: it cannot see variables of your test.

Under `tsx` a function must not contain a named inner function; see the [note](Pages-and-browsers#functions-under-tsx).

## Waiting for state

```ts
await spinner.waitFor({ state: "hidden", timeout: 10_000 });
```

States: `"visible"` (default), `"hidden"` (not attached counts), `"attached"`, `"detached"`. It does not scroll.

## Strict mode

By default an action or a read uses the first match when a locator matches several elements. Strict mode makes it an error instead, which catches a locator that is less specific than you thought:

```ts
// samurai.config.ts
export default defineConfig({ use: { strictSelectors: true } });
```

```ts
page.setStrictSelectors(true); // for this page; `undefined` goes back to the config
await page.locator("li").strict().click(); // one locator, on or off whatever the page says
await page.locator("li").strict(false).click();
```

With strict mode on, `click`, `fill`, `textContent`, `isVisible` and the other actions and reads throw `click(): strict mode violation, 3 elements match css=li`. Narrow the locator with `first()`, `nth()`, `filter()` or a more specific query. Steps added to a strict locator stay strict. It is off unless you turn it on; the first of `locator.strict()`, `page.setStrictSelectors()` and `use.strictSelectors` that is set decides. A locator asks once, at its first action or read, and keeps the answer: `page.setStrictSelectors()` reaches locators made afterwards and earlier ones that have not run anything yet.

Strict mode leaves `count()`, `all()` and `elements()` alone, since they are meant to see every match, and it does not throw for the result of `first()` or `nth()`, which is one element by definition.

## Errors

- **`ActionTimeoutError`**: the element didn't become actionable in time. The message names the failing checks (`visible`, `stable`, `hit target`, …) and, for a covered element, what covers it.
- **`InvalidSelectorError`**: the browser rejected the CSS or XPath. Thrown at once, not retried.
- **`UnsupportedOperationError`**: the browser doesn't implement that kind of locator (for example `getByRole` on a browser without the accessibility locator).

## Scope and limits

Locators search the top-level document. They don't pierce iframes, and shadow DOM only as far as the browser's own `locateNodes` does.
