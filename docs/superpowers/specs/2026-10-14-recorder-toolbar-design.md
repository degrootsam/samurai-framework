# Recorder toolbar (B)

**Date:** 2026-10-14 · **Status:** design, awaiting review · **Repos:** `samurai-framework` (0.7.0), `samurai` (app)

## Context

Project A (managed browsers, framework 0.6.0) moved recording into a real browser window that SAMURAI
provides. This project puts a toolbar into that window, so a whole test can be recorded there:
assertions, credentials, waits and screenshots, without leaving the window or editing the spec by hand.
Project C (Chrome over BiDi) comes after; the toolbar is written so it needs no extra work there.

Today the recorder (`page.record`, `recordSpec`) injects a capture script that reports clicks, typing,
Enter/Tab/Escape and Alt+click assertions. Password fields become `secrets.<NAME>`. There is no way to
pause, to choose an assertion, to insert a variable, to wait for a set time or to take a screenshot.

## Goal

Everything a tester needs while recording is one click away in the recording window, and every action
becomes a step in the spec. The toolbar is the framework's, so `samurai record` and the app both get it.

## Decisions

| Question                   | Decision                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Mechanism                  | Shadow-DOM overlay injected by a BiDi preload script, in a sandbox realm; stock browser builds       |
| Layout                     | A vertical rail (design C), top right by default; drag anywhere, collapse to a chip                  |
| Where state lives          | The recorder in Node. The toolbar draws the state it is sent and reports presses                     |
| Assertions                 | Assert → pick an element → a panel with the matchers, prefilled from the element, editable, with Not |
| Insert                     | Focus a field, then pick a variable or secret; the real value is typed, the reference recorded       |
| Missing variable or secret | Added from the Insert panel: written to the project, typed, recorded                                 |
| Pause                      | Nothing is recorded. On resume on another page the toolbar asks whether to add a `goto`              |
| Wait                       | "Until the page settles" (`waitForNetworkIdle`) or "For N seconds" (new `waitForTimeout`)            |
| Screenshot                 | A new step that saves a PNG as evidence at run time. No comparison                                   |
| Release                    | Framework 0.7.0; the app bumps to it                                                                 |

## The toolbar

The approved mockups: <!-- link added after review: the published mockups page -->.

### Rail

- Default spot: top right, 12 px from the edges. Drag by the grip row to anywhere in the window; the rail
  is kept fully inside the window, also when the window is resized. The spot is kept for the whole
  recording, across page loads.
- Rows: grip and collapse chevron; status ("Recording" with a red dot, or "Paused" with an amber dot);
  Pause / Resume; Assert; Insert; Wait; Screenshot; Stop.
- Collapsed: a chip with the grip, the status dot, the step count ("Rec · 7 steps") and an expand arrow.
  Still draggable. Recording continues.
- Paused: amber dot, the note "Nothing you do now is recorded.", Resume highlighted, Assert, Insert, Wait
  and Screenshot disabled, Stop enabled.
- While a tool is active its row is highlighted. Esc or a click outside a panel closes it without adding
  anything. A toast at the bottom of the window confirms an added step that has no visible effect
  ("Screenshot step added", "Wait step added").

### Assert

1. Assert: the rail shows "Click an element · Esc cancels"; elements are outlined under the pointer. The
   click is not passed to the page.
2. A panel opens beside the element. Header: "Assert" and the element's best locator in short
   (`heading "Sign in"`).
3. Matchers: Visible, Has text, Contains text, Has value, Has attribute, Count. The first choice and its
   value follow today's Alt+click rule (`toHaveValue` for fields, `toHaveText` up to 100 characters,
   `toContainText` beyond, `toBeVisible` without text). Has attribute lists the element's attributes
   with their values (first 20). Count offers up to three locators that match more than one element (the
   element's role without a name, its tag with its classes) with their counts, the first preselected.
4. The value is editable; a Not checkbox makes it `.not`. Add writes the `expect` step.

Alt+click stays the one-click shortcut and works as today.

### Insert

- Insert uses the text field that had focus before Insert was opened. With none, the panel says "Click
  into a field first".
- Header: `Insert into "Email"` and `Environment: dev`. A filter. Two groups:
  - Variables of the recording's environment, with their values.
  - Secrets of the recording's environment, names only; a value shows as `••••••`, a missing one as
    "not set".
- Picking a variable or a set secret types its value into the field and records
  `fill(env.<name>)` / `fill(secrets.<NAME>)`.
- Picking a secret that is not set opens the New secret form for it ("Set value").
- The end of the list always has "+ Add variable" and "+ Add secret". When the filter matches nothing,
  they read `+ Add variable "<filter>"` and `+ Add secret "<FILTER IN UPPER SNAKE CASE>"`.

### New variable or secret

- A Variable / Secret switch, Name, and "Value in <environment>" (masked for a secret). The name is
  prefilled from the filter, else from the field's label, name or id (`email` / `EMAIL`).
- Variable: hint "Saved to `environments.<env>.variables` in samurai.config.ts. Other environments don't
  get it — add it there before running against them."
- Secret: hint "Saved as `SAMURAI_SECRET_<NAME>` in `.env.<env>` (git-ignored)." When `.env.<env>` is not
  ignored by git, the hint is a warning instead: "Add .env.<env> to .gitignore before committing."
- Save and insert: writes the value to the project, types it into the field and records the `fill`.
  Cancel goes back to the list.
- Values entered as variables are strings.

### Wait

Two choices and Add: "Until the page settles" (sub-line "No requests for 500 ms") →
`await page.waitForNetworkIdle();`; "For N seconds" (0.1–60, default 2) →
`await page.waitForTimeout(2000);`. Waiting for an element is an assertion (Visible), which waits.

### Screenshot

Name (prefilled `screenshot-<n>`, n counting the test's screenshot steps), "Visible part" or "Whole
page", Add → `await page.screenshot({ name: "after-sign-in" });` (with `fullPage: true` for the whole
page). Names keep letters, digits, `-` and `_`; anything else becomes `-`. Nothing is captured while
recording.

### Pause, resume, stop

- Pause: the recorder drops everything the capture script reports, including navigations.
- Resume: if the page's URL differs from the URL at pause, the rail asks "Add a step that opens this
  page?" Yes writes a `goto` (relative to the base URL when inside it); No adds nothing. Either way
  recording continues.
- Stop: ends the recording as closing the window does. An open panel is dropped.

## Framework

### Realms and scripts

- **Toolbar script** (`src/recorder/toolbar/`): a preload script in a BiDi sandbox realm named
  `samurai-toolbar`, top-level documents only. It attaches a closed shadow root to a
  `<samurai-recorder-toolbar>` element on `document.documentElement` (`position: fixed`, the highest
  z-index, `all: initial` inside). The site's scripts share the DOM but not the sandbox's globals, so
  they cannot call into it or patch what it uses. Like the capture script it is a string, so no
  transpiler helper ends up in it.
- **Capture script** (changed): ignores events whose `composedPath()` contains the toolbar's host
  element, and has a muted state (set while paused and while the recorder types an inserted value).
- **Shared candidate code**: the element-candidate functions (`candidatesOf`, `roleOf`, …) move to one
  source snippet used by both scripts, so a picked element gets the same candidates as a clicked one.

### Messages

Page → recorder, over the recorder's `script.message` channel, `{ type: "toolbar", action, … }`:
`ready`, `pause`, `resume`, `resume-goto { add: boolean }`, `stop`, `move { x, y }`, `collapse
{ collapsed }`, `pick { target, candidates }`, `assert { target, matcher, expected?, name?, not }`,
`insert { target, candidates, kind: "env" | "secret", name }`, `add-insertable { target, candidates,
kind, name, value }`, `wait { kind: "idle" | "time", ms? }`, `screenshot { name, fullPage }`.

Recorder → page: a function call into the sandbox of each loaded top-level context:
`update(state)` after every change and after every page load, and `reply(id, result)` for `pick`,
`insert` and `add-insertable`. `state` is `{ status: "recording" | "paused", collapsed, position,
steps, environment?, variables: [{ name, value }], secrets: [{ name, set }], resumeQuestion?: boolean,
toast? }`. Secret values never go to the page.

### Recorder

The recorder owns the toolbar state and decides every step:

- Pause gate; the URL at pause; the resume question.
- `pick`: ranks the element's locators as for a click; replies with the short label, text, value,
  attributes, the first matcher and value (the Alt+click rule), and the Count candidates with their
  counts. An element no locator identifies replies "This element can't be identified uniquely", and the
  panel offers no Add.
- `insert`: mutes capture, fills the field through the page API (BiDi input), unmutes, and emits the
  `fill` with the reference. Typing errors reply "Couldn't type into that field" and emit nothing.
- `add-insertable`: writes the variable or secret (below), adds it to the state, then does `insert`.
- `ready`: a top-level page whose toolbar has not sent `ready` 2 s after its load is reported as
  `toolbar: false` in the status (below).
- The normaliser gets new observations for each and turns them into steps. A pending `fill` is closed
  before any toolbar step, so a wait after typing lands after the `fill`.

`RecorderOptions` gains `variables: Record<string, string | number | boolean>`, `secrets: Record<string,
string | undefined>` (names of the environment's secrets: those the spec files use and those in
`.env.<env>`, with their values), `environment?: string`, `projectDir`, `onStatus?(status)` and
`onStop?()`.

### recordSpec

- Reads the environment's variables and secrets and passes them in.
- `onStatus?: (status: { state: "recording" | "paused"; toolbar: boolean }) => void`, called on every
  change.
- Toolbar Stop resolves the recording like a closed window.
- `RecordResult.secrets` also lists secrets added from the panel.

### Writing to the project

- `src/project/config-edit.ts`: `editConfig(source, path, value)` moves here from the app
  (`src/main/utils/config-edit.ts`), unchanged in behaviour: only the addressed property's text changes,
  missing objects are created, `ConfigEditError` when the file is not shaped for a safe edit.
- `src/project/variables.ts`: `addVariable(projectDir, environment, name, value)`.
- `src/project/secrets-file.ts`: `setSecret(projectDir, environment, name, value)`, writing
  `SAMURAI_SECRET_<NAME>=<value>` to `.env.<environment>` (replacing an existing line, quoting as the
  app does), and `isGitIgnored(projectDir, file)`.
- Exported as `@itmetsam/samurai-framework/project`. The app's Settings keep their own copies for now;
  switching them over is a later change.

### Steps

| Step                              | Source                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `waitForTimeout` `{ ms }`         | `await page.waitForTimeout(2000);`                                            |
| `screenshot` `{ name, fullPage }` | `await page.screenshot({ name: "after-sign-in" });` / `…, fullPage: true });` |

Both are added to the step model, the parser, the emitter and `applyEdit`, with the same exact-shape
rule as the other steps. `ms` is a non-negative integer literal.

### Page API

- `page.waitForTimeout(ms)`: waits `ms` milliseconds; rejects on a negative or non-finite value.
- `page.screenshot({ name })`: `name` is new. With it, the image is also saved as
  `<result dir>/screenshots/<test file>/<test name>/<name>.png` (names cleaned as above; a second
  screenshot with the same name in the same test gets `-2`, `-3`, …) and added to the test's report
  entry as `screenshots: [{ name, path }]`, `path` relative to the result folder, next to its logs.
  Outside a test run the image goes to `<result dir>/screenshots/<name>.png`. `path` and `name` can be
  combined. A screenshot never compares anything; a capture that fails is a test error like any step.

## The app

- Bumps to framework 0.7.0.
- **Engine and record service:** `record` forwards `onStatus` as a `record-status` message; main
  broadcasts `record:status { projectId, state, toolbar }`. Stop from the app and Stop from the toolbar
  end the same way (`record:done`).
- **Test editor:** the status panel reads "Recording in the browser window" with "Stop". Paused shows the
  Paused pill (warning tone, no pulse) and "Paused in the browser window". With `toolbar: false` the
  panel adds "The toolbar couldn't load on this page. Alt+click still records assertions."
- **Steps in the editor:** labels, icons and edit forms for Wait (seconds) and Screenshot (name, whole
  page).
- **Run detail:** each test lists its screenshots (thumbnail, name; click opens it full size).
- **Docs:** `docs/screens/test-editor.md` drops its "project B target" notes for the shipped wording;
  `docs/screens/run-detail.md` gets the screenshots.
- Projects on framework 0.6 or older: no `record-status` arrives; the panel shows "Recording in the
  browser window" with Stop and no pause state. Their parser reads the new steps as `custom`.

## Errors

| Case                                                  | Behaviour                                                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolbar doesn't load on a page                        | Recording continues; Alt+click works; status `toolbar: false`; the app says so                                                                  |
| Page in an iframe                                     | No toolbar or capture there (as today)                                                                                                          |
| Picked element not uniquely identifiable              | Panel: "This element can't be identified uniquely"; no Add                                                                                      |
| Insert with no field focused                          | "Click into a field first"                                                                                                                      |
| Secret not set                                        | Opens New secret for it                                                                                                                         |
| Typing the value fails                                | Toast "Couldn't type into that field"; no step                                                                                                  |
| No environment for the recording                      | Insert lists no variables or secrets and says "This recording has no environment"; adding is disabled                                           |
| Config can't be edited safely                         | Panel: "samurai.config.ts can't be changed automatically. Add `<name>` to `environments.<env>.variables` yourself." Nothing written or inserted |
| Name exists or is invalid                             | Message under the name field ("`adminUser` already exists", "Use letters, digits and _; a secret is UPPER_SNAKE_CASE")                          |
| `.env.<env>` not git-ignored                          | Warning in the New secret form; the save still works                                                                                            |
| Window closed while paused, or Stop with a panel open | The recording ends normally                                                                                                                     |
| Screenshot fails at run time                          | Test error, like any failing step                                                                                                               |
| Screenshot name repeats in a test                     | `-2`, `-3`, …                                                                                                                                   |

## Testing

**Framework**

- Normaliser: each new observation (assert with matcher and Not, insert env / secret, both waits,
  screenshot, goto after resume, nothing while paused, a pending `fill` closed before a toolbar step).
- Codec: parse / emit / round-trip for `waitForTimeout` and `screenshot`, and shapes that stay `custom`.
- Writers: `editConfig` (moved with its tests), `addVariable` creates `environments.<env>.variables`,
  `setSecret` adds and replaces lines, `isGitIgnored`.
- Real Firefox (`*.browser-test.ts`):
  - the toolbar appears, and the page's own script cannot reach its globals;
  - a click in the toolbar records nothing;
  - pause records nothing; resume on another page asks and writes the `goto`;
  - insert types the real value and records `env.x`; adding a variable from the panel updates the
    config, the field and the steps;
  - the Assert panel's prefill (text, value, attributes, count);
  - state survives navigation to a second origin (two local servers);
  - one test clicks the real toolbar by coordinates; the rest drive it through its messages.
- Runner: a test with `page.screenshot({ name })` writes the PNG and its report entry;
  `waitForTimeout` waits.

**App**

- Engine and service forward `record-status`.
- Pure helpers for the new step kinds' labels and forms; run detail reads screenshots from the report.
- Verification includes `electron-vite build` (A's `@renderer` import broke the build while `tsc`
  passed).
- Manual test plan in the PR: record a sign-in using every tool, including adding a missing variable
  and secret, then run it.

## Order of work

1. Framework 0.7.0: steps and page API, writers, toolbar and recorder, recordSpec, docs. Release (the
   user publishes).
2. App: bump, record status, editor steps and panel, run detail screenshots, docs.

## Out of scope

- Chrome (C), iframes, editing or deleting steps from the toolbar.
- Visual comparison of screenshots, masking secrets in screenshots.
- Switching the app's Settings to the framework's writers.
- Variables of other environments when adding one (only the recording's environment gets the value).
