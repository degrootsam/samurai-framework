# `expect` assertions — design

Date: 2026-09-29
Status: approved in brainstorming, pending spec review

## Goal

Give tests a single `expect()` API for:

- **Locators** — web-first assertions that auto-retry until the DOM matches or a timeout expires.
- **Plain values** — synchronous, Jest-style matchers.

A failing assertion throws, stops the test, and is reported as `type: "assertion"` with `expected` / `actual`.

```ts
import { expect } from "../assert/expect.js";

await expect(page.locator("div[@class='alert']")).toBeVisible();
await expect(page.locator("h1")).not.toHaveText(/error/i, { timeout: 2000 });

expect(count).toBeGreaterThan(2);
expect(result).toEqual({ ok: true });
```

## Non-goals (v1)

- Soft assertions (`expect.soft`).
- Custom matchers / `expect.extend()`.
- Page-level matchers (`toHaveURL`, `toHaveTitle`).

## Components

### `src/assert/expect.ts`

- `expect` overloads:
  - `expect(locator: Locator): LocatorAssertions`
  - `expect<T>(value: T): ValueAssertions<T>`
  - Dispatch by `value instanceof Locator`.
- `LocatorAssertions` — every matcher returns `Promise<void>` and takes an optional last argument `{ timeout?: number }`:
  - `toBeVisible()`
  - `toHaveText(expected: string | RegExp)` — string compares against trimmed `textContent` exactly.
  - `toContainText(expected: string | RegExp)` — string is a substring check.
  - `toHaveValue(expected: string | RegExp)`
  - `toHaveAttribute(name: string, expected: string | RegExp)`
  - `toHaveCount(expected: number)`
- `ValueAssertions<T>` — every matcher returns `void`:
  - `toBe(expected)` — `Object.is`.
  - `toEqual(expected)` — `util.isDeepStrictEqual`.
  - `toBeTruthy()`, `toBeFalsy()`
  - `toContain(item)` — arrays (`includes`) and strings (substring).
  - `toMatch(pattern: string | RegExp)` — strings only.
  - `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeLessThan`, `toBeLessThanOrEqual` — numbers/bigints.
- Both classes expose a `.not` getter returning a negated instance.
- Type misuse (e.g. `toMatch` on a non-string, number comparison on a non-number) throws a `TypeError`, not an `AssertionError`.

### `src/assert/assertion-error.ts`

`AssertionError extends Error` with:

- `matcher: string` — e.g. `"toHaveText"` or `"not.toHaveText"`.
- `expected: unknown`, `actual: unknown`
- `locator?: string` — the XPath, for locator assertions.

Message format:

```
expect(locator).toHaveText
  locator: //h1
  expected: "Contact"
  received: "Home"
```

Values are formatted by a shared `format()`: strings quoted, RegExp as `/src/flags`, other values via `util.inspect` with `depth: 2`.

### `src/locator/locator.ts` — new public reads

None of these throw when the element is missing; an evaluate exception (e.g. invalid XPath) still throws.

| Method | Returns | Missing element |
|---|---|---|
| `isVisible()` | `boolean` — exists, bounding box width and height > 0, computed style not `display:none`, `visibility:hidden`, `opacity:0` | `false` |
| `textContent()` | trimmed `string` | `null` |
| `inputValue()` | `string` (`.value`) | `null` |
| `getAttribute(name)` | `string` | `null` (also when the attribute is absent) |
| `count()` | `number` via XPath `count(...)` with `XPathResult.NUMBER_TYPE` | `0` |

## Retry behaviour (locator matchers only)

- Internal `poll(read, check, timeout)`:
  1. `actual = await read()`; with `timeout > 0` the read is raced against the time left until the deadline (start + timeout), and the race timer is cleared when the read wins.
  2. If `check(actual) !== negated` → resolve.
  3. If elapsed ≥ timeout → throw `AssertionError` with the last `actual`.
  4. Otherwise wait 100 ms and repeat.
- The timeout is a hard bound: if the deadline expires while a read is still pending, the matcher throws `AssertionError` with the last completed `actual`, or, when no read ever completed, a plain `Error`: `expect(locator).<matcher>: could not read <selector> within <timeout>ms`.
- A matcher always reads at least once, even with `timeout: 0`; with `timeout: 0` that single read is awaited without a race.
- Errors thrown by `read()` (invalid XPath, BiDi socket closed after the browser was killed) are rethrown immediately, not retried.
- Timeout resolution: per-call `{ timeout }` → config `expect.timeout` → default `5000` ms.
- `SamuraiTestConfig` gains `expect?: { timeout?: number }`.

## Failure reporting

- `TestError.type` becomes `"timeout" | "error" | "assertion"`, with optional `expected?: unknown` and `actual?: unknown`. The reporter stores them as-is (JSON-serialisable values); a RegExp, bigint, symbol or function, or any value `JSON.stringify` rejects (e.g. a circular object), is stored as its `format()` string.
- `test-runner.ts`: in the test's `catch`, `err instanceof AssertionError` → `type: "assertion"` with `expected` / `actual`; everything else stays `"error"`.

### Missing-`await` guard

- Every locator assertion is added to a module-level `pendingAssertions` registry in `expect.ts`. It is removed as soon as anyone subscribes to it (`await`, `.then`, `.catch`, `.finally`, `Promise.all`, `assert.rejects`) or when it passes. An un-awaited assertion that fails stays in the registry: a failure nobody observed is the same silent-pass trap as one still running.
- To detect `await`, matchers return a `Promise` subclass (still typed `Promise<void>`) whose overridden `then` removes it from the registry; `await` calls that `then` because the constructor is not the native `Promise`. Promises derived from it are plain promises.
- `expect.ts` exports `takePendingAssertions(): string[]`, which returns the matcher names of un-awaited assertions that are still running or already failed, and clears the registry.
- After the test function resolves, the runner calls it; if the result is non-empty, the test fails with `type: "assertion"` and message `expect(locator).<matcher>() was not awaited`.
- Each assertion gets an internal rejection handler (which does not count as awaiting), so an un-awaited failure is never an unhandled rejection.

## Testing

- Runner: Node's built-in `node:test` via tsx. `package.json`: `"test": "tsx --test \"src/**/*.test.ts\""`.
- `src/assert/expect.test.ts`:
  - Each value matcher: pass, fail, `.not`, `AssertionError` fields, `TypeError` on misuse.
  - Locator matchers against a stub `BiDiConnector` whose `send("script.evaluate")` returns a scripted sequence of results:
    - passes after N polls,
    - times out with the last `actual`,
    - rethrows on an evaluate exception without retrying,
    - `.not` variants,
    - per-call `timeout` overrides the default.
  - Missing-`await` guard: an un-awaited locator assertion shows up in `takePendingAssertions()`, also when it already failed; an awaited one never does, pass or fail.
- End-to-end: `src/tests/index.spec.ts` asserts `toHaveValue` on the filled fields and `toBeVisible` on the name field; verified with `bun run dev` against Firefox.
- TDD: write each test before its implementation.

## Out of scope, noted

- `Page.navigateTo` builds `` `${protocol}://url` `` (literal `url`) for scheme-less URLs — separate fix.
