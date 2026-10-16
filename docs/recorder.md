# Steps and the recorder

Two building blocks for a recorder UI, and the toolbar that the recorder shows in the browser window. The Electron app (item 5 of the [recorder roadmap](superpowers/recorder-roadmap.md)) builds on them; all three work and are tested.

- the **step codec** turns a `.spec.ts` into a list of steps and writes edits back with minimal diffs
- the **recorder engine** watches a person use the browser and reports steps as they happen
- the **recorder toolbar** is a small panel inside the recorded page for the steps that clicking can't make: assertions with a choice of matcher, variables and secrets, waits and screenshots, and pause

The `.spec.ts` file stays the source of truth; steps are a view of it.

## Steps

A test body is read as a list of steps. The recorder only writes this restricted set, so reading it back is reliable:

| Step                 | Source                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `goto`               | `await page.goto("/login");`                                                                |
| `click`              | `await page.getByRole("button", { name: "Save" }).click();`                                 |
| `fill`               | `await page.getByLabel("Email").fill("a@b.c");` (value may be `env.name` or `secrets.NAME`) |
| `press`              | `await page.getByLabel("New todo").press("Enter");`                                         |
| `setInputFiles`      | `await page.getByLabel("Avatar").setInputFiles("files/avatar.png");` (also an array, `[]`)  |
| `dropFiles`          | `await page.getByTestId("zone").dropFiles(["files/a.png", "files/b.png"]);`                 |
| `expect`             | `await expect(locator).toHaveText("Saved");` (also `.not`)                                  |
| `waitForNetworkIdle` | `await page.waitForNetworkIdle();`                                                          |
| `waitForTimeout`     | `await page.waitForTimeout(2000);` (a whole number of milliseconds)                         |
| `screenshot`         | `await page.screenshot({ name: "after-sign-in" });` (also `fullPage: true`)                 |
| `custom`             | Any other statement, kept verbatim                                                          |

Locators in steps are chains of `locator`, `getByCss`, `getByText`, `getByLabel`, `getByRole` and `getByTestId`, optionally followed by `.withFallbacks(...)` with more chains. Expectations: `toBeVisible`, `toHaveText`, `toContainText`, `toHaveValue` (string or regex literal), `toHaveAttribute(name, expected)`, `toHaveCount(n)`.

A `waitForTimeout` with a variable or a fractional number, or a `screenshot` with a path or any option besides `name` and `fullPage`, is `custom`. Specs written by 0.6 still parse; 0.6 reads the two new steps as custom code.

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

`samurai record <spec>` records into a spec file in one go: see [Command line](cli.md#samurai-record-spec). From code, `recordSpec({ file, create?, test?, at?, url?, environment?, signal? })` (from `/recorder`) does the same and resolves when `signal` aborts, the window closes or Stop is pressed on the toolbar. `onStatus({ state: "recording" | "paused", toolbar })` is called when the recording is paused or resumed or the toolbar fails or comes back on a page. There is no initial call: until the first one, the status is `{ state: "recording", toolbar: true }`.

## The toolbar

While `samurai record` (or `recordSpec`) runs, a rail sits at the top right of the page. It is a closed shadow DOM drawn by a script in a sandbox realm named `samurai-toolbar`: the page's own scripts and monkeypatched globals can't reach that script or the shadow DOM, the page's styles don't apply inside it, and it is styled through the CSSOM, so a content security policy that forbids inline styles doesn't break it either. The toolbar talks to the recorder over its own channel, which never appears on the page's `window`, and the recorder takes toolbar messages only from that sandbox realm, so a page script can't send it actions (such as typing a secret into a field of its choosing). Keys, typed text and the clipboard of the toolbar's inputs are stopped before the page's own listeners see them; on the page the recording starts on, listeners that page registered before the recording began still run first and can see those keys, so add a secret there only on a page you trust, or navigate once first. It is shown on top-level documents only, and again on every page the recording navigates to. What you do on the rail is never recorded as a click.

| Control    | What it does                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grip       | Drag it to move the rail anywhere in the window. It stays fully inside the window and keeps its spot across page loads                            |
| Chevron    | Collapses the rail to a chip ("Rec · 7 steps"). Recording continues, and the chip can still be dragged                                            |
| Pause      | Nothing you do is recorded, navigations included. The rail says "Paused" and "Nothing you do now is recorded."                                    |
| Resume     | Records again. When the page changed while paused, the rail asks "Add a step that opens this page?": Yes writes a `goto`, No adds nothing         |
| Assert     | Click an element, then choose a matcher. See below                                                                                                |
| Insert     | Types a variable or secret into the field you had focused. See below                                                                              |
| Wait       | "Until the page settles" (`waitForNetworkIdle`, "No requests for 500 ms") or "For N seconds" (0.1 to 60, default 2; `waitForTimeout`)             |
| Screenshot | A name (prefilled `screenshot-<n>`) and "Visible part" or "Whole page". Nothing is captured while recording; the step takes it when the test runs |
| Stop       | Ends the recording, as closing the window does. An open panel is dropped                                                                          |

Wait and Screenshot show a toast ("Wait step added", "Screenshot step added"). While paused, Assert, Insert, Wait and Screenshot are disabled; Stop is not. Esc, or a click outside a panel, closes it without adding a step.

### Assert

Press Assert; the rail says "Click an element · Esc cancels" and outlines the element under the pointer. The click does not reach the page. A panel opens beside the element with its best locator and these matchers:

| Matcher       | Step              | Notes                                                                           |
| ------------- | ----------------- | ------------------------------------------------------------------------------- |
| Visible       | `toBeVisible`     |                                                                                 |
| Has text      | `toHaveText`      | The value is editable                                                           |
| Contains text | `toContainText`   | The value is editable                                                           |
| Has value     | `toHaveValue`     | For fields                                                                      |
| Has attribute | `toHaveAttribute` | Lists the element's attributes (the first 20) with their values                 |
| Count         | `toHaveCount`     | Offers up to three locators that match more than one element, with their counts |

The first choice follows the Alt+click rule above. The Not checkbox writes `.not`. "This element can't be identified uniquely" appears when no locator matches only that element. Alt+click still works as the one-click shortcut.

### Insert

Insert types into the text field that had focus before you opened it. With none, the panel says "Click into a field first". It lists the variables of the recording's environment (with their values) and its secrets (names only; a value shows as `••••••`, a missing one as "not set"). The list has a filter.

- A variable is typed into the field and recorded as `fill(env.<name>)`; a secret as `fill(secrets.<NAME>)`. Even when the page re-renders the field on every input, exactly one such `fill` is recorded.
- A step that reads `env` or `secrets` adds it to the test's parameters (`async ({ page, env }) =>`) when it isn't there yet. Parameters that can't take it, a plain name such as `async (fixtures) =>` or a `...rest`, are left as they are.
- The secrets listed are those with a value (`.env.<environment>` or a `SAMURAI_SECRET_*` variable) plus the `secrets.X` names the recorded spec file already reads. Other spec files are not scanned.
- Picking a secret that is not set opens the form to set it.
- "+ Add variable" and "+ Add secret" (with the filter as the name) open a form: Name, and the value in the environment. "Save and insert" writes it, types it into the field and records the `fill`.
- If the field can't be typed into, a toast says "Couldn't type into that field". For "Save and insert" the value is written first: the toast then says "Saved X, but couldn't type into that field", and the variable or secret stays in the project. Only an element that can't be identified uniquely ("This element can't be identified uniquely") stops the write.
- A secret's value never goes to the page: the toolbar gets secret names and whether they are set. A value you type into the New secret form stays in the toolbar too (see below).

Where an added value goes:

| Kind     | Written to                                            | Notes                                                                                                  |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Variable | `environments.<env>.variables` in `samurai.config.ts` | A string. Other environments don't get it: add it there before running against them                    |
| Secret   | `SAMURAI_SECRET_<NAME>` in `.env.<env>`               | When `.env.<env>` is not git-ignored, the form warns `Add .env.<env> to .gitignore before committing.` |

A config that can't be edited automatically (for example, computed `environments`) gives an error that names the variable to add yourself. When the config has no `environments` object, the recording has no environment: Insert lists only secrets (read from and written to `.env.default`), and adding a variable is disabled with "This recording has no environment".

A secret added from the panel is in `RecordResult.secrets`, so the CLI's closing note about which `SAMURAI_SECRET_*` to set includes it.

### When the toolbar can't load

A page can fail to load the toolbar. The rail then shows nothing, the recorder reports `toolbar: false`, and the CLI prints "The toolbar couldn't load on this page. Alt+click still records assertions." Recording itself continues.

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

| They…                          | Step                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| click something                | `click`, on the nearest interactive element (a label click records its control)                                                                                                                                                                                                                                      |
| type into a field              | one `fill`, rewritten (`replace`) as the text grows; the focus click is dropped                                                                                                                                                                                                                                      |
| press Enter, Tab or Escape     | `press`, after the `fill` it follows. Typing in the same field afterwards is a **new** `fill`, so a todo list that clears its field on Enter records every item. Enter on a button or link is the click it causes, Enter in a textarea is typing, and Shift+Tab or a key with Ctrl, Alt or Meta held is not recorded |
| type into a password field     | `fill` with `secrets.<FIELD_NAME>`. The value never leaves the page                                                                                                                                                                                                                                                  |
| Alt+click an element           | `expect`, which the page never sees as a click: `toHaveValue` for fields, `toHaveText` for text up to 100 characters, `toContainText` beyond, `toBeVisible` for no text. The element under the pointer is outlined while Alt is held                                                                                 |
| pick files in a file input     | `setInputFiles` with the files stored in `files/` (see [Files](#files)). A click that opened the picker is replaced by this step; a cancelled picker removes the click                                                                                                                                               |
| drop files on the page         | `dropFiles` on the element they landed on, with the files stored in `files/`                                                                                                                                                                                                                                         |
| navigate right after an action | `waitForNetworkIdle`                                                                                                                                                                                                                                                                                                 |
| navigate on their own          | `goto` (relative to `baseURL` when the URL is inside it)                                                                                                                                                                                                                                                             |
| use the toolbar                | See [The toolbar](#the-toolbar)                                                                                                                                                                                                                                                                                      |

For every element the recorder tries locators in order of stability — test id, role and accessible name, label, text, `#id`, `[name]` or `[placeholder]` CSS, and finally an absolute XPath — and keeps only candidates that match exactly **one** element, the one the person used. The best becomes the primary locator and up to two more become its `withFallbacks`. An element that no candidate identifies is skipped with a warning.

### Files

Files a person picks or drops are copied into one folder shared by the whole project: `files/` at the project root, or `filesDir` in `samurai.config.ts` (relative to the project folder). The steps point at them with project-relative paths, so a test runs from any directory and the files are committed with the tests.

- A file whose content is already in the folder (same size and SHA-256) is reused, not copied again. The same name with other content is stored as `name-2.ext`, `name-3.ext`, and so on. An existing file is never overwritten.
- Files over 50 MB are not stored. The step is still written, pointing at the path the file would have, and the person is told: the toolbar shows `<name> is <size>. Files over 50 MB aren't saved: add it to files/ yourself, or use a generated file.` until it is dismissed, `samurai record` prints the same line, and `RecordResult.missingFiles` lists them (as does `recordSpec`'s `onMissingFile`). A file that can't be read is handled the same way. Add the file to the folder before running the test, or use `generatedFile` (see [Locators](locators.md#generatedfile)).
- While a file is being copied the toolbar shows `Saving <name>…`. Stopping the recording finishes the transfers already started.
- When the folder is git-ignored, `samurai record` prints `files/ is ignored by git; CI won't have these files.` (`RecordResult.filesIgnored`). The first time files are stored, it says `Recorded files are stored in files/ and committed with your tests.` (`RecordResult.firstFiles`).
- Events the person did not cause (a script calling `click()` or dispatching a `drop`) are ignored: only trusted events are recorded. Nothing is recorded while paused.

### Recording from the middle of a test

Pass `at` (the number of steps before the new ones) and `initialGoto: false`. The engine numbers the new steps from `at`; the caller must bring the browser to the state steps `0…at-1` lead to, for example by running them first. The engine does not replay anything.

### Limits

Not recorded yet: `<select>` choices, other key presses (arrows, shortcuts), hover, drag, contenteditable typing and dialogs. The recorder and the toolbar cover top-level documents only: clicks inside iframes are not recorded and the toolbar is not shown in them. A modal dialog the page opens can cover the toolbar (a known limitation): close it, or use Alt+click and the keyboard. One recorder per page at a time. Recording uses a browser window of its own.
