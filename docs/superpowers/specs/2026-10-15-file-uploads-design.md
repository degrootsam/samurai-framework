# File uploads in recorded tests (D)

**Date:** 2026-10-15 · **Status:** draft · **Repos:** `samurai-framework` (0.8.0), `samurai` (app)

## Context

The recorder (framework 0.7) records clicks, typing, assertions, variables, secrets, waits and
screenshots. Files are not recorded: a person who picks a file in the recording window, or drops one on
a dropzone, gets no step for it, and the file itself is gone once the recording ends. On a server or CI
there is no way to get it back.

At run time the framework can already set files: `locator.setInputFiles(paths)` (BiDi `input.setFiles`)
and `setFiles` for file pickers. Paths resolve against the working directory. There is no way to drop
files on an element, and no step kind for either action.

Playwright and Selenium have no native file drop either; both build the files in the page and fire a
synthetic `drop`. Playwright's codegen records `setInputFiles` only. WebDriver BiDi has `input.setFiles`
and no file drop.

## Goal

A file upload made while recording replays anywhere the project is checked out. Picked and dropped files
are stored once in the project and committed with the tests. Tests that need a file of a given size
(upload limits, load tests) can use a file generated at run time instead of a stored one.

## Decisions

| Question                     | Decision                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is captured             | The file's name, type and contents. The path on disk is not available to pages and is not needed                                                                                                              |
| Interactions                 | `<input type=file>` changes (also hidden inputs behind a button) and drops of files                                                                                                                           |
| How the bytes leave the page | Read in the recorder's sandbox with `FileReader` as base64 data URLs (Firefox forbids TypedArray access over Xrays, so `arrayBuffer()` bytes can't be read there), sent over the files channel in 1 MB chunks |
| Where files live             | One shared `files/` folder at the project root; `filesDir` in `samurai.config.ts` changes it                                                                                                                  |
| Duplicates                   | Content dedupe by SHA-256: identical content is stored once, whatever its name                                                                                                                                |
| Name clashes                 | Same name, other content: `<name>-2.<ext>`, `-3`, …; an existing file is never overwritten                                                                                                                    |
| Size cap                     | 50 MB per file while recording. Bigger files get a step but are not stored, with a warning                                                                                                                    |
| Drop replay                  | Temporary sandbox `<input type=file>` + `input.setFiles`, then synthetic `dragenter`, `dragover`, `drop`                                                                                                      |
| Generated files              | `generatedFile({ name, size, type? })`: seeded pseudo-random bytes written at run time, never stored                                                                                                          |
| Version                      | Framework 0.8.0                                                                                                                                                                                               |

## Steps

Two step kinds, both with a list of files:

```ts
type FileEntry =
  | { path: string } // relative to the project folder, e.g. "files/avatar.png"
  | { generate: { name: string; size: number; type?: string } }; // size in bytes

type Step =
  | …
  | { kind: "setInputFiles"; locator: LocatorSpec; files: FileEntry[] }
  | { kind: "dropFiles"; locator: LocatorSpec; files: FileEntry[] };
```

Source form. One file is written bare, several as an array, `[]` clears an input:

```ts
await page.getByLabel("Avatar").setInputFiles("files/avatar.png");
await page.getByTestId("dropzone").dropFiles(["files/a.png", "files/b.png"]);
await page
  .getByLabel("Upload")
  .setInputFiles(
    generatedFile({ name: "huge.pdf", size: "60 MB", type: "application/pdf" }),
  );
await page.getByLabel("Avatar").setInputFiles([]);
```

- `generatedFile` is a new export of the package. `size` in source is a number of bytes or a string
  with a unit: `B`, `KB`, `MB`, `GB` (powers of 1024), e.g. `"60 MB"`, `"1.5 GB"`. The codec keeps
  the string form the source used when it writes a step back; a new step is written with the largest
  unit that gives a whole number (`"60 MB"`, `"1536 KB"`).
- Anything else in the arguments (a variable, a computed path, an options object) makes the statement
  a `custom` step, as today.
- A step that uses `generatedFile` adds it to the spec's import from `@itmetsam/samurai-framework`
  when it is not imported yet (like the fixture parameters in 0.7.1).

## Running

- `locator.setInputFiles(files)` and the new `locator.dropFiles(files)` take a path, a
  `generatedFile(…)`, or an array of both.
- **Paths** resolve against the project folder (not the working directory), so a run works from any
  directory. Absolute paths are used as they are. A path that does not exist fails the step:
  `files/a.png doesn't exist in the project` (absolute: `<path> doesn't exist`).
- **Generated files** are written to `result/files/<size>/<name>` (so the page sees the generated name) in 1 MB chunks, at most once per
  run for the same name, size and type, and removed when the run ends. The bytes come from a
  pseudo-random generator seeded with the name and size: the same in every run, and not compressible.
  The browser gets the path, so a 2 GB file never sits in memory.
- `dropFiles` checks the target is attached and visible, creates a hidden `<input type=file multiple>`
  in the recorder's sandbox realm (outside the page's reach), sets the files on it with
  `input.setFiles`, fires `dragenter`, `dragover` and `drop` on the target with a `DataTransfer`
  holding those files, and removes the input. The events bubble and are cancelable; `isTrusted` is
  false, which a page that only accepts trusted drops rejects (a documented limitation).
- `setInputFiles` keeps its checks (attached, enabled, need not be visible) and its `multiple` check.

## Recording

### Picking files

- A trusted `change` on an `<input type=file>` records `setInputFiles` on that input. Picking again
  records a new step. A change to no files records `setInputFiles([])`.
- A click that opens a picker is not recorded as a click. A recorded click is followed, in the same
  task, by a `click` event on an `<input type=file>` (the page calls `input.click()`, or the click
  is on a `<label>` for the input): that click becomes the pending upload. On `change` it is replaced
  by `setInputFiles`; on the input's `cancel` event it is removed. A click directly on a visible file
  input is handled the same way.
- A trusted `drop` whose `dataTransfer.types` includes `"Files"` records `dropFiles` on the drop's
  target element. The file list is taken during the event (it is unreadable afterwards); the files
  are read afterwards. Drops of text or links, and drops on the toolbar, are not recorded.
- Nothing is recorded while paused. Untrusted events are ignored, so a page script cannot fake a drop
  to write files into the project.

### Transfer and storage

- For each file, the sandbox sends `file-start` (name, type, size), then 1 MB base64 chunks, then
  `file-end`. The toolbar shows `Saving avatar.png…` while a transfer runs. The step is written once
  all its files are stored; steps recorded meanwhile keep their order.
- The recorder hashes the content (SHA-256) and compares it with the files in `files/` of the same
  size only. A match is reused. Otherwise the file is saved under its cleaned name, or `<name>-2`,
  `-3`, … when that name is taken.
- Cleaning a name: drop any path part (`/`, `\`), control characters and leading dots; trim; cap at
  120 characters keeping the extension; an empty result becomes `file`. The resolved path must stay
  inside `files/` (or `filesDir`), or the file is not written.
- A file over 50 MB is not read. The step is still written, with `files/<cleaned name>`, and:
  - the toolbar shows a warning that stays until dismissed: `big.mov is 300 MB. Files over 50 MB
aren't saved: add it to files/ yourself, or use a generated file.`
  - the CLI prints the same line at once;
  - `RecordResult.missingFiles` lists it (`{ path, name, size }`), and the CLI summary and the app
    list it again when the recording ends.
- A file that cannot be read (removed from disk after picking, permission error) is handled like an
  oversized one, with `couldn't be read` in the warning.

### Warnings after a recording

- `files/` (or `filesDir`) is ignored by git: `files/ is ignored by git; CI won't have these files.`
- The first time a project gets recorded files (the folder did not exist before): `Recorded files are
stored in files/ and committed with your tests.`

`RecordResult` gets `files: string[]` (paths stored or reused this recording), `missingFiles` and
`filesIgnored: boolean`.

## Framework

- `src/steps`: the two step kinds, `FileEntry`, codec (parse, emit, size strings), the import of
  `generatedFile` when a step needs it.
- `src/browser`: `locator.dropFiles`, project-relative paths and generated entries for
  `setInputFiles`, the generated-file writer and its cleanup.
- `src/recorder`: capture of `change`, picker clicks, `cancel` and `drop`; the chunked transfer on the
  toolbar channel; the file store (clean, hash, dedupe, write); the toolbar's saving notice and
  oversize warning; `RecordResult` fields; CLI output.
- `src/config`: `filesDir` (default `"files"`, relative to the project folder).
- `src/steps/build.ts` (flows and step runs): runs the new kinds.
- Docs: `recorder.md` (what is recorded, storage, cap, warnings; remove file uploads from "not
  recorded yet"), `locators.md` (`dropFiles`, generated files, project-relative paths),
  `configuration.md` (`filesDir`), `cli.md` (record output), `roadmap.md`.

## The app

- **Step list:** `Upload files` / `Drop files`, the target, and the names: `avatar.png`,
  `report.pdf +2`. Generated files show as `huge.pdf (60 MB, generated)`. A step with a missing
  project file shows a warning icon.
- **Side panel** for a file step:
  - the target locator, edited like other steps;
  - the switch between upload and drop;
  - the file list, one row per file: from the project (path, size, or `Missing` with a warning) or
    generated (name, size with a unit, type). Rows can be removed and reordered;
  - `Add file…` opens the system file picker; the chosen file is copied into `files/` by the main
    process with the same cleaning and dedupe as the recorder (no cap: the person chose it on purpose);
  - `Add generated file`;
  - for a missing file: `Add file…` to supply it, or `Use generated file` (same name and recorded
    size).
- **Add-step menu:** `Upload files` and `Drop files`, starting with an empty list.
- **After recording:** the record alert lists missing files and the git warnings next to the secrets
  warning.
- **Run detail:** a failing file step shows the framework's error; nothing else changes.
- **Older frameworks** (before 0.8.0): the steps are custom code there; the add-step menu hides
  `Upload files` and `Drop files`, like Wait and Screenshot on 0.6.
- The app reads file presence and sizes through the main process; paths are checked to stay inside the
  project.

## Errors

| Situation                            | What happens                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| Picked or dropped file over 50 MB    | Step written, file not stored, toolbar + CLI warning at once, listed in `missingFiles` |
| File unreadable while recording      | Same as over 50 MB, `couldn't be read`                                                 |
| Run: project file missing            | Step fails: `files/a.png doesn't exist in the project`                                 |
| Run: several files on a single input | Step fails as today (`multiple` check)                                                 |
| Run: drop target hidden or detached  | Step fails with the usual actionability error after the timeout                        |
| Cleaned name would leave `files/`    | Not written; the step lists it as missing                                              |
| `files/` ignored by git              | Warning after recording                                                                |
| Recording stopped during a transfer  | The step is written with what was stored; unfinished files are listed as missing       |

## Testing

### Framework tests

- Unit: codec round-trip of both kinds (one file, several, `[]`, generated with each unit), custom
  fallback for other arguments, the `generatedFile` import being added once; size parsing and
  formatting; name cleaning (separators, `..`, control characters, empty, long names); dedupe (same
  content other name reused, same name other content suffixed, only same-size files hashed).
- Browser:
  - spike first: a `change` and a `drop` in Firefox's sandbox realm deliver bytes that reach the
    recorder intact, at 1 KB and at 50 MB;
  - recording an input change, a hidden input behind a button (the click is replaced), a cancelled
    picker (the click is removed), a drop on a dropzone, a drop of text (not recorded), a file over the
    cap (step, warning, `missingFiles`), paused (nothing);
  - replay of `dropFiles` against a page with a real `drop` handler and of `setInputFiles` with
    project-relative paths from another working directory;
  - generated files: size exact, same bytes in two runs, removed after the run.

### App tests

- Step views (labels, `+N`, generated, missing icon), the side panel's file list editing, the
  copy-into-`files/` handler (path checks, dedupe, suffix), the missing-file check, the add-step menu
  hiding on frameworks before 0.8.0, and the record alert's file warnings.

## Order of work

1. Framework spike (sandbox reads file bytes, chunked transfer), then the rest of the framework; 0.8.0
   is published by the user.
2. The app, against the published 0.8.0.

## Out of scope

- A files manager in the app (which tests use which file, delete unused): a follow-up.
- Generating valid files of a type (a real PDF or PNG of a given size).
- File drops inside iframes, and drags of elements within the page.
- `showOpenFilePicker` (File System Access API), which Firefox does not support.
- Recording files over 50 MB.
