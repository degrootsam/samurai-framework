# Recorder engine — design

Date: 2026-10-02
Status: implemented
Roadmap item: 4 (phase 2)
Depends on: semantic locators, step codec

## Goal

Watch a person use the page in the (external) recording browser and report steps as they happen, so the UI can stream them into the step list and the codec can write them into the spec.

```ts
const recorder = await page.record({
  at: 3, // number of steps before the recording; default 0
  initialGoto: false, // the page is already where step 3 leaves it; default true
  baseURL: "https://app.test",
  onEvent: (event) => {
    /* { op: "insert" | "replace", index, step } */
  },
});
await recorder.stop();
```

`applyRecorderEvent(source, testIndex, event)` writes an event into the spec through the codec.

## Components (`src/recorder/`)

- **Channel plumbing** (`src/script/`): `ChannelArg` serialises to a BiDi channel argument; `addPreload` takes `arguments` and passes them to the preload registration and to the immediate run in loaded documents. `Locator.elements()` exposes the matched element references.
- **`capture.ts`**: preload script, run in the page's own realm in the top-level document. Reports `click`, `input` and `assert` messages over a `script.message` channel, each with the element (as a node reference) and ordered locator candidates: test id, role and accessible name, label, text, `#id` / `[name]` / `[placeholder]` css, and an absolute xpath that always exists. Clicks go to the nearest interactive element; a label click reports its control and the click the browser forwards is dropped. Password values never leave the page. While Alt is held the hovered element is outlined, and an Alt+click is swallowed (the page never sees it) and reported as `assert`. Starting a second recording in a document reuses the installed listeners with the new channel.
- **`ranking.ts`**: a candidate is used only when it matches exactly one element and that element is the target (compared by shared id, checked with the real locators). The first is the primary, up to two more become `withFallbacks`. Results are cached per element until the next navigation. An element with no qualifying candidate is skipped with a warning.
- **`normalise.ts`**: pure. Typing becomes one `fill` that is `replace`d as the text grows; password fields become `secrets.<FIELD_NAME>`; clicks on text fields are dropped (the `fill` needs no focus click); a top-level navigation within 2 s of an action becomes `waitForNetworkIdle`, any other navigation `goto` (relative to `baseURL`); an Alt+click becomes `expect` (`toHaveValue` for fields, `toHaveText` for up to 100 characters of text, else `toContainText`, `toBeVisible` for no text).
- **`recorder.ts`**: subscribes to `script.message` and `browsingContext.navigationStarted`, registers the preload, processes events in order (ranking is async), and on `stop` switches the page scripts off, flushes the queue and removes everything it registered.

## Non-goals and limits

- Replaying steps `0…at-1` before recording from `at` is the caller's job (the Electron app); the engine only numbers steps from `at`.
- Not recorded: `<select>` choices, key presses (Enter, Tab), hover, drag, iframes, contenteditable typing, file uploads, dialogs. Each needs a step kind first.
- One recorder per page at a time.
