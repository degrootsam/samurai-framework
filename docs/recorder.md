# Steps and the recorder

Two building blocks for a recorder UI. The UI itself (item 5 of the [recorder roadmap](superpowers/recorder-roadmap.md)) is not built yet, but both parts work and are tested.

- the **step codec** turns a `.spec.ts` into a list of steps and writes edits back with minimal diffs
- the **recorder engine** watches a person use the browser and reports steps as they happen

The `.spec.ts` file stays the source of truth; steps are a view of it.

## Steps

A test body is read as a list of steps. The recorder only writes this restricted set, so reading it back is reliable:

| Step                 | Source                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `goto`               | `await page.goto("/login");`                                                                |
| `click`              | `await page.getByRole("button", { name: "Save" }).click();`                                 |
| `fill`               | `await page.getByLabel("Email").fill("a@b.c");` (value may be `env.name` or `secrets.NAME`) |
| `expect`             | `await expect(locator).toHaveText("Saved");` (also `.not`)                                  |
| `waitForNetworkIdle` | `await page.waitForNetworkIdle();`                                                          |
| `custom`             | Any other statement, kept verbatim                                                          |

Locators in steps are chains of `locator`, `getByCss`, `getByText`, `getByLabel`, `getByRole` and `getByTestId`, optionally followed by `.withFallbacks(...)` with more chains. Expectations: `toBeVisible`, `toHaveText`, `toContainText`, `toHaveValue` (string or regex literal), `toHaveAttribute(name, expected)`, `toHaveCount(n)`.

A statement is a known step only when its shape is exactly the emitted one. Extra arguments, unknown options, template strings with substitutions, or variables (`const link = …; await link.click()`) turn it into `custom` steps. Nothing is lost: custom code is written back unchanged.

## The codec

```ts
import { parseSpec } from "./src/steps/parse.js";
import { stepToSource } from "./src/steps/emit.js";
import { applyEdit } from "./src/steps/edit.js";

const source = readFileSync("src/tests/login.spec.ts", "utf8");

const tests = parseSpec(source); // tests, also inside describe(); each has steps with source ranges
tests[0].name; // "Login > signs in"
tests[0].steps[1].step; // { kind: "click", locator: { chain: [...], fallbacks: [] } }

stepToSource({ kind: "goto", url: "/home" }); // 'await page.goto("/home");'

const next = applyEdit(source, {
  op: "replace",
  test: 0,
  index: 0,
  step: { kind: "goto", url: "/home" },
});
```

`applyEdit(source, edit)` returns the new source. Edits address a test by its index in `parseSpec`'s result:

| Edit                                   | Effect                                                        |
| -------------------------------------- | ------------------------------------------------------------- |
| `{ op: "replace", test, index, step }` | Rewrites one statement                                        |
| `{ op: "insert", test, index, step }`  | New step at `index` (`index` equal to the step count appends) |
| `{ op: "remove", test, index }`        | Deletes the statement's lines, with the comments above it     |
| `{ op: "move", test, from, to }`       | Moves a step so it ends up at `to` (its comments stay behind) |

Only the touched statement changes; formatting and comments elsewhere stay byte for byte. Inserted code copies the neighbours' indentation and is written on one line with double quotes, so run a formatter (Trunk does this on commit) if you want it wrapped. An out-of-range position throws `RangeError`.

`locatorFromSpec(page, spec)` (`src/steps/build.ts`) builds the real locator for a step's locator spec, which is what a step runner needs.

## Recording from the command line

`samurai record <spec>` records into a spec file in one go: see [Command line](cli.md#samurai-record-spec). From code, `recordSpec({ file, create?, test?, at?, url?, environment?, signal? })` (from `/recorder`) does the same and resolves when `signal` aborts or the window closes.

## Recording

```ts
const recorder = await page.record({
  onEvent: (event) => {
    /* { op: "insert" | "replace", index, step } */
  },
  at: 0, // index the first recorded step gets
  initialGoto: true, // write the page the recording starts on as a goto
  baseURL: "https://app.test",
});
// …a person uses the browser window…
await recorder.stop();
```

Write events into a spec with the codec:

```ts
import { applyRecorderEvent } from "./src/recorder/apply.js";

source = applyRecorderEvent(source, testIndex, event);
```

What the person does, and the steps that come out:

| They…                          | Step                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| click something                | `click`, on the nearest interactive element (a label click records its control)                                                                                                                                                      |
| type into a field              | one `fill`, rewritten (`replace`) as the text grows; the focus click is dropped                                                                                                                                                      |
| type into a password field     | `fill` with `secrets.<FIELD_NAME>`. The value never leaves the page                                                                                                                                                                  |
| Alt+click an element           | `expect`, which the page never sees as a click: `toHaveValue` for fields, `toHaveText` for text up to 100 characters, `toContainText` beyond, `toBeVisible` for no text. The element under the pointer is outlined while Alt is held |
| navigate right after an action | `waitForNetworkIdle`                                                                                                                                                                                                                 |
| navigate on their own          | `goto` (relative to `baseURL` when the URL is inside it)                                                                                                                                                                             |

For every element the recorder tries locators in order of stability — test id, role and accessible name, label, text, `#id`, `[name]` or `[placeholder]` CSS, and finally an absolute XPath — and keeps only candidates that match exactly **one** element, the one the person used. The best becomes the primary locator and up to two more become its `withFallbacks`. An element that no candidate identifies is skipped with a warning.

### Recording from the middle of a test

Pass `at` (the number of steps before the new ones) and `initialGoto: false`. The engine numbers the new steps from `at`; the caller must bring the browser to the state steps `0…at-1` lead to, for example by running them first. The engine does not replay anything.

### Limits

Not recorded yet: `<select>` choices, key presses (Enter, Tab, …), hover, drag, iframes, contenteditable typing, file uploads and dialogs. One recorder per page at a time. Recording uses the external browser window; embedding the page in an editor is on the [roadmap](roadmap.md).
