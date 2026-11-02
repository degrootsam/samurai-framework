# Step codec — design

Date: 2026-10-02
Status: implemented
Roadmap item: 3 (phase 2)
Depends on: test API alignment, semantic locators

## Goal

Turn a `.spec.ts` file into a list of steps per test and write edits back as minimal diffs. The `.spec.ts` stays the source of truth; the UI edits steps, not text.

## Components (`src/steps/`)

- **`model.ts`**: `Step` is the restricted set the recorder writes: `goto`, `click`, `fill`, `expect` (`toBeVisible`, `toHaveText`, `toContainText`, `toHaveValue`, `toHaveAttribute`, `toHaveCount`, optionally `.not`), `waitForNetworkIdle`, and `custom` (any other statement, kept verbatim). A locator is a chain of `page.…` calls (`locator`, `getByCss`, `getByText`, `getByLabel`, `getByRole`, `getByTestId`) plus the `withFallbacks(...)` chains. A `fill` value is a literal, `env.NAME` or `secrets.NAME`; expectations take a string or a regex literal.
- **`parse.ts`** (`parseSpec`): TypeScript AST (the `typescript` package, now a runtime dependency). Finds `test(...)` calls, also inside `describe(...)`, and maps each statement of the callback body. A statement matches only when its shape is exactly the emitted one (no extra arguments, no options the model cannot hold, no variables); otherwise it is `custom`. Each step carries its source range and the start of its leading comments.
- **`emit.ts`** (`stepToSource`): canonical one-line statement, double-quoted strings. Parsing an emitted step gives the same step back.
- **`edit.ts`** (`applyEdit`): `replace`, `insert`, `remove`, `move` on one test's steps. Only the touched statement's text changes; formatting and comments elsewhere stay byte for byte. Insert copies the neighbouring indentation and goes above the next step's leading comments; remove deletes the statement's lines with its leading comments; a moved step loses its comments. Out-of-range positions throw `RangeError`.

## Non-goals

- Reading values from variables: `const link = page.locator(…); await link.click()` shows as two custom steps.
- Re-indenting or reformatting existing code; Trunk's formatter does that.
